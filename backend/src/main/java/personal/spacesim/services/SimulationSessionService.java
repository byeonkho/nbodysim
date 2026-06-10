package personal.spacesim.services;

import org.orekit.time.AbsoluteDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.dtos.SimulationResponseMetadata;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Component
public class SimulationSessionService {

    private final Logger logger = LoggerFactory.getLogger(SimulationSessionService.class);

    // Sessions idle longer than this are evicted by the periodic sweeper.
    private static final long IDLE_TIMEOUT_MS = 15 * 60 * 1000;

    // Hard cap on concurrent live sessions, bounding total heap on a small VM.
    // Each idle session holds its cached compressed chunk + body state (a few
    // MB); the precompute pool is bounded to ~cores/2 threads, so only a couple
    // of sessions sit at serialization peak (~20 MB) at once while the rest hold
    // their idle footprint. 50 keeps worst-case heap well under a ~1 GB budget
    // while absorbing a realistic concurrent-visitor spike. Conservative —
    // refine under load. Complements the idle sweeper, which only reclaims
    // sessions after IDLE_TIMEOUT_MS.
    private static final int MAX_CONCURRENT_SESSIONS = 50;

    private final ConcurrentHashMap<String, Simulation> simulationMap;
    private final ConcurrentHashMap<String, Long> lastAccessedAt;
    private final SimulationFactory simulationFactory;
    private final BinaryResponseSerializer binaryResponseSerializer;
    private final ZstdCompressor zstdCompressor;

    // Per-session next-chunk precompute. The future may be in-flight or done.
    // Missing entry = no precompute kicked off yet (first request, or after eviction).
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> nextChunkCache;

    // Bounded executor for precompute work. Threads are daemon so they don't
    // prevent JVM shutdown if a request is in flight at exit.
    private final ExecutorService precomputeExecutor = Executors.newFixedThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors() / 2),
            r -> {
                Thread t = new Thread(r, "spacesim-precompute");
                t.setDaemon(true);
                return t;
            });

    @Autowired
    public SimulationSessionService(
            SimulationFactory simulationFactory,
            BinaryResponseSerializer binaryResponseSerializer,
            ZstdCompressor zstdCompressor
    ) {
        this.simulationFactory = simulationFactory;
        this.binaryResponseSerializer = binaryResponseSerializer;
        this.zstdCompressor = zstdCompressor;
        this.simulationMap = new ConcurrentHashMap<>();
        this.lastAccessedAt = new ConcurrentHashMap<>();
        this.nextChunkCache = new ConcurrentHashMap<>();
    }

    public String createSimulation(
            List<String> celestialBodyNames,
            String frame,
            String integrator,
            AbsoluteDate simStartDate,
            String timeStep,
            int keyframesPerKept,
            int targetSnapshotsPerChunk
    ) {
        // Reject before doing the expensive build (body wrappers, possible
        // Horizons fetches) if we're already at capacity. Soft check — a tiny
        // race can let a few past the cap, which is harmless for a heap guard.
        if (simulationMap.size() >= MAX_CONCURRENT_SESSIONS) {
            throw new SessionCapacityExceededException(
                    "Server at capacity (" + MAX_CONCURRENT_SESSIONS + " concurrent sessions)");
        }

        String sessionID = UUID.randomUUID().toString();
        Simulation simulation = simulationFactory.createSimulation(
                sessionID,
                celestialBodyNames,
                frame,
                integrator,
                simStartDate,
                timeStep,
                keyframesPerKept,
                targetSnapshotsPerChunk
        );
        simulationMap.put(sessionID, simulation);
        lastAccessedAt.put(sessionID, System.currentTimeMillis());
        logger.info("sessionID: {}", sessionID);
        return sessionID;
    }

    public SimulationResponseDTO returnSimulationResponseDTO(String sessionID) {
        Simulation simulation = simulationMap.get(sessionID);
        List<CelestialBodyWrapper> celestialBodyList = simulation.getCelestialBodies();
        SimulationResponseMetadata simulationResponseMetadata = new SimulationResponseMetadata(sessionID);
        return new SimulationResponseDTO(celestialBodyList, simulationResponseMetadata);
    }

    public Simulation getSimulation(String sessionID) {
        return simulationMap.get(sessionID);
    }

    public List<Simulation> getAllSimulations() {
        return new ArrayList<>(simulationMap.values());
    }

    public void removeSimulation(String sessionID) {
        simulationMap.remove(sessionID);
        lastAccessedAt.remove(sessionID);
        CompletableFuture<byte[]> pending = nextChunkCache.remove(sessionID);
        if (pending != null) {
            pending.cancel(true);
        }
    }

    /**
     * Returns the next zstd-compressed chunk byte[] for the session, taking
     * it from the precompute cache when available. Always kicks off the next
     * precompute before returning, so subsequent calls hit the cache.
     */
    public byte[] getNextChunkBytes(String sessionID) {
        lastAccessedAt.put(sessionID, System.currentTimeMillis());

        CompletableFuture<byte[]> cached = nextChunkCache.remove(sessionID);
        byte[] payload;
        if (cached != null) {
            try {
                // Either ready (instant) or still in-flight from prior precompute (await).
                payload = cached.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Interrupted while awaiting precomputed chunk", e);
            } catch (ExecutionException e) {
                throw new RuntimeException("Precompute failed", e.getCause());
            }
        } else {
            // Cold path: no precompute kicked off yet (first request post-init,
            // or post-eviction). Compute synchronously on the request thread.
            payload = computeChunkBytes(sessionID);
        }

        // Kick off the next precompute so the next request hits cache.
        kickOffNextPrecompute(sessionID);
        return payload;
    }

    /**
     * Test-only accessor: returns the current in-flight or completed precompute
     * future for the session, or null if none is pending. Production code paths
     * use {@link #getNextChunkBytes}.
     */
    public CompletableFuture<byte[]> peekPrecomputedChunk(String sessionID) {
        return nextChunkCache.get(sessionID);
    }

    private void kickOffNextPrecompute(String sessionID) {
        // computeIfAbsent prevents double-kickoff if a caller races with us.
        nextChunkCache.computeIfAbsent(sessionID, id ->
                CompletableFuture.supplyAsync(() -> computeChunkBytes(id), precomputeExecutor));
    }

    private byte[] computeChunkBytes(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        if (simulation == null) {
            throw new IllegalArgumentException("Simulation not found for session ID: " + sessionID);
        }

        ChunkResult chunkResult = simulation.run();

        // µ map built fresh each chunk; constant per session but cheap (~9 entries).
        LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
        for (CelestialBodyWrapper w : simulation.getCelestialBodies()) {
            muByName.put(w.getName(), w.getMu());
        }

        byte[] binary = binaryResponseSerializer.serialize(chunkResult, muByName);
        return zstdCompressor.compress(binary);
    }

    public List<CelestialBodyWrapper> getSimulationResults(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        return simulation != null ? simulation.getCelestialBodies() : new ArrayList<>();
    }

    /**
     * Periodically evict simulations that haven't been accessed in IDLE_TIMEOUT_MS.
     * Replaces the prior WS-disconnect-triggered cleanup; with HTTP we have no
     * connection lifecycle to hook into.
     */
    @Scheduled(fixedRate = 60_000)
    public void evictIdleSimulations() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Long>> it = lastAccessedAt.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> entry = it.next();
            if (now - entry.getValue() > IDLE_TIMEOUT_MS) {
                String sessionID = entry.getKey();
                simulationMap.remove(sessionID);
                CompletableFuture<byte[]> pending = nextChunkCache.remove(sessionID);
                if (pending != null) {
                    pending.cancel(true);
                }
                it.remove();
                logger.info("Evicted idle simulation {}", sessionID);
            }
        }
    }
}
