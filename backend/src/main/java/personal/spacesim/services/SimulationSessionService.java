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
import java.util.concurrent.locks.ReentrantLock;

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

    // Per-session chunk-protocol state. servedChunkIndex is the index of the last
    // chunk produced for the session (-1 = none yet). lastChunkBytes holds that
    // chunk's payload so a client retry for the same index re-serves it instead of
    // advancing the cursor (idempotent retry, fixes the dropped-chunk-on-blip bug).
    // sessionLocks serializes the decide-and-produce critical section per session,
    // so Simulation.run() is never executed concurrently for one session.
    private final ConcurrentHashMap<String, Integer> servedChunkIndex = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, byte[]> lastChunkBytes = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ReentrantLock> sessionLocks = new ConcurrentHashMap<>();

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
        clearChunkProtocolState(sessionID);
    }

    /**
     * Returns the zstd-compressed bytes for the session's chunk at
     * {@code expectedChunkIndex}. Serial per session: the decide-and-produce body
     * runs under a per-session lock, so at most one Simulation.run() executes for a
     * session at a time (no interleaved state corruption). The index gate makes the
     * call idempotent: a request for the last-served index re-serves the cached
     * bytes without advancing; the next sequential index produces and advances;
     * anything else is a conflict. Always kicks off the next precompute after
     * producing, so subsequent calls hit cache.
     */
    public byte[] getNextChunkBytes(String sessionID, int expectedChunkIndex) {
        Simulation simulation = simulationMap.get(sessionID);
        if (simulation == null) {
            // Evicted, released, or never existed. Throw BEFORE touching
            // lastAccessedAt: resurrecting a dead session's idle clock on every
            // retry would defeat eviction.
            throw new SessionNotFoundException("No live session for ID: " + sessionID);
        }
        lastAccessedAt.put(sessionID, System.currentTimeMillis());

        ReentrantLock lock = sessionLocks.computeIfAbsent(sessionID, id -> new ReentrantLock());
        lock.lock();
        try {
            int served = servedChunkIndex.getOrDefault(sessionID, -1);

            // Idempotent retry: the client is re-requesting the chunk it was last
            // served but never received (its fetch died after we computed). Re-serve
            // the cached bytes without advancing the cursor.
            if (expectedChunkIndex == served) {
                byte[] cached = lastChunkBytes.get(sessionID);
                if (cached != null) {
                    return cached;
                }
                // served set but bytes absent should never happen; recomputing would
                // double-advance, so surface it rather than corrupt the timeline.
                throw new ChunkIndexConflictException(expectedChunkIndex, served);
            }

            // Anything other than the next sequential chunk: cursors diverged by
            // more than the one re-servable step. Never silently advance.
            if (expectedChunkIndex != served + 1) {
                throw new ChunkIndexConflictException(expectedChunkIndex, served);
            }

            // Produce the next chunk: consume the precompute future if present
            // (common case), else compute on this thread (first request or
            // post-eviction). The lock is held across get(); the precompute task
            // does not take the lock, so there is no deadlock, and concurrent
            // same-session requests serialize as intended.
            CompletableFuture<byte[]> cached = nextChunkCache.remove(sessionID);
            byte[] payload;
            if (cached != null) {
                try {
                    payload = cached.get();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("Interrupted while awaiting precomputed chunk", e);
                } catch (ExecutionException e) {
                    throw new RuntimeException("Precompute failed", e.getCause());
                }
            } else {
                payload = computeChunkBytes(sessionID);
            }

            servedChunkIndex.put(sessionID, expectedChunkIndex);
            lastChunkBytes.put(sessionID, payload);
            kickOffNextPrecompute(sessionID);
            return payload;
        } finally {
            lock.unlock();
        }
    }

    private void clearChunkProtocolState(String sessionID) {
        servedChunkIndex.remove(sessionID);
        lastChunkBytes.remove(sessionID);
        sessionLocks.remove(sessionID);
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
                clearChunkProtocolState(sessionID);
                logger.info("Evicted idle simulation {}", sessionID);
            }
        }
    }
}
