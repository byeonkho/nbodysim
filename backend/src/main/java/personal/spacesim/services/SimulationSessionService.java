package personal.spacesim.services;

import jakarta.annotation.PreDestroy;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.LongSupplier;

@Component
public class SimulationSessionService {

    private final Logger logger = LoggerFactory.getLogger(SimulationSessionService.class);

    // Sessions idle longer than this are evicted by the periodic sweeper.
    private static final long IDLE_TIMEOUT_MS = 15 * 60 * 1000;

    // Admission includes pending initialization, not just published sessions.
    // This bounds session count; actual heap requirements still need load testing.
    private static final int MAX_CONCURRENT_SESSIONS = 50;
    private static final int MAX_COMPUTATIONS =
            Math.max(2, Runtime.getRuntime().availableProcessors() / 2);
    private final Semaphore sessionSlots;
    private final int maxSessions;
    // Both foreground and speculative work reserve before starting. No backlog:
    // foreground overload returns 503, optional speculation is simply skipped.
    private final Semaphore computeSlots;

    private final ConcurrentHashMap<String, SimulationSessionState> sessions;
    private final SimulationFactory simulationFactory;
    private final BinaryResponseSerializer binaryResponseSerializer;
    private final ZstdCompressor zstdCompressor;
    private final LongSupplier currentTimeMillis;

    // Bounded executor for precompute work. Threads are daemon so they don't
    // prevent JVM shutdown if a request is in flight at exit.
    private final ExecutorService precomputeExecutor;

    @Autowired
    public SimulationSessionService(
            SimulationFactory simulationFactory,
            BinaryResponseSerializer binaryResponseSerializer,
            ZstdCompressor zstdCompressor
    ) {
        this(simulationFactory, binaryResponseSerializer, zstdCompressor,
                System::currentTimeMillis);
    }

    SimulationSessionService(
            SimulationFactory simulationFactory,
            BinaryResponseSerializer binaryResponseSerializer,
            ZstdCompressor zstdCompressor,
            LongSupplier currentTimeMillis
    ) {
        this(simulationFactory, binaryResponseSerializer, zstdCompressor,
                currentTimeMillis, MAX_CONCURRENT_SESSIONS, MAX_COMPUTATIONS);
    }

    SimulationSessionService(
            SimulationFactory simulationFactory,
            BinaryResponseSerializer binaryResponseSerializer,
            ZstdCompressor zstdCompressor,
            LongSupplier currentTimeMillis,
            int maxSessions,
            int maxComputations
    ) {
        if (maxSessions < 1 || maxComputations < 1) {
            throw new IllegalArgumentException("Capacity limits must be positive");
        }
        this.maxSessions = maxSessions;
        this.sessionSlots = new Semaphore(maxSessions);
        this.computeSlots = new Semaphore(maxComputations);
        this.precomputeExecutor = Executors.newFixedThreadPool(maxComputations, r -> {
            Thread t = new Thread(r, "spacesim-precompute");
            t.setDaemon(true);
            return t;
        });
        this.simulationFactory = simulationFactory;
        this.binaryResponseSerializer = binaryResponseSerializer;
        this.zstdCompressor = zstdCompressor;
        this.currentTimeMillis = currentTimeMillis;
        this.sessions = new ConcurrentHashMap<>();
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
        if (!sessionSlots.tryAcquire()) {
            throw new SessionCapacityExceededException(
                    "Server at capacity (" + maxSessions + " concurrent sessions)");
        }
        boolean registered = false;
        try {
            String sessionID = UUID.randomUUID().toString();
            Simulation simulation = simulationFactory.createSimulation(
                    sessionID, celestialBodyNames, frame, integrator, simStartDate,
                    timeStep, keyframesPerKept, targetSnapshotsPerChunk);
            sessions.put(sessionID, new SimulationSessionState(
                    simulation, currentTimeMillis.getAsLong()));
            registered = true;
            logger.info("sessionID: {}", sessionID);
            return sessionID;
        } finally {
            if (!registered) sessionSlots.release();
        }
    }

    public SimulationResponseDTO returnSimulationResponseDTO(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        if (simulation == null) {
            throw sessionNotFound(sessionID);
        }
        List<CelestialBodyWrapper> celestialBodyList = simulation.getCelestialBodies();
        SimulationResponseMetadata metadata = new SimulationResponseMetadata(sessionID);
        return new SimulationResponseDTO(celestialBodyList, metadata);
    }

    public Simulation getSimulation(String sessionID) {
        SimulationSessionState state = sessions.get(sessionID);
        return state == null ? null : state.liveSimulation();
    }

    public List<Simulation> getAllSimulations() {
        List<Simulation> simulations = new ArrayList<>();
        for (SimulationSessionState state : sessions.values()) {
            Simulation simulation = state.liveSimulation();
            if (simulation != null) {
                simulations.add(simulation);
            }
        }
        return simulations;
    }

    public void removeSimulation(String sessionID) {
        closeSession(sessionID, sessions.get(sessionID));
    }

    /**
     * Returns the zstd-compressed bytes for the session's chunk at
     * {@code expectedChunkIndex}. Serial per session: the decide-and-produce body
     * runs under a per-session lock, so at most one Simulation.run() executes for a
     * session at a time (no interleaved state corruption). The index gate makes the
     * call idempotent: a request for the last-served index re-serves the cached
     * bytes without advancing; the next sequential index produces and advances;
     * anything else is a conflict. Result publication and next-chunk precompute
     * are atomic with session closure, so late work cannot restore a dead session.
     */
    public byte[] getNextChunkBytes(String sessionID, int expectedChunkIndex) {
        SimulationSessionState state = sessions.get(sessionID);
        if (state == null || !state.touchIfOpen(currentTimeMillis.getAsLong())) {
            throw sessionNotFound(sessionID);
        }

        Simulation simulation = state.simulationForWork();
        ReentrantLock lock = state.requestLock();
        lock.lock();
        try {
            SimulationSessionState.ChunkReservation reservation =
                    state.reserveChunk(expectedChunkIndex);
            if (reservation.isRetry()) {
                return reservation.retryPayload();
            }

            CompletableFuture<byte[]> cached = reservation.precomputedChunk();
            byte[] payload;
            try {
                payload = cached != null
                        ? cached.get()
                        : computeOnDemand(simulation);
            } catch (SessionCapacityExceededException e) {
                // No state was advanced. The same chunk index remains retryable.
                throw e;
            } catch (InterruptedException e) {
                if (cached != null) {
                    cached.cancel(true);
                }
                Thread.currentThread().interrupt();
                closeSession(sessionID, state);
                throw new RuntimeException("Interrupted while awaiting precomputed chunk", e);
            } catch (ExecutionException e) {
                closeSession(sessionID, state);
                throw new RuntimeException("Precompute failed", e.getCause());
            } catch (RuntimeException e) {
                // Simulation.run() advances mutable state before serialization and
                // compression. Once either post-run step fails, retrying this index
                // would compute from a later state and silently skip an interval.
                // Invalidate the session so the client must initialize a fresh one.
                closeSession(sessionID, state);
                throw e;
            }

            try {
                boolean published = state.publishChunk(
                        expectedChunkIndex,
                        payload,
                        () -> startPrecompute(simulation));
                if (!published) {
                    throw sessionNotFound(sessionID);
                }
            } catch (SessionNotFoundException e) {
                throw e;
            } catch (RuntimeException e) {
                closeSession(sessionID, state);
                throw e;
            }
            return payload;
        } finally {
            lock.unlock();
        }
    }

    private void closeSession(String sessionID, SimulationSessionState state) {
        if (state == null) {
            return;
        }
        SimulationSessionState.Closure closure = state.close();
        if (sessions.remove(sessionID, state)) sessionSlots.release();
        cancelPrecompute(closure.pendingPrecompute());
    }

    private static void cancelPrecompute(CompletableFuture<byte[]> pending) {
        if (pending != null) {
            pending.cancel(true);
        }
    }

    private SessionNotFoundException sessionNotFound(String sessionID) {
        return new SessionNotFoundException("No live session for ID: " + sessionID);
    }

    /**
     * Test-only accessor: returns the current in-flight or completed precompute
     * future for the session, or null if none is pending. Production code paths
     * use {@link #getNextChunkBytes}.
     */
    public CompletableFuture<byte[]> peekPrecomputedChunk(String sessionID) {
        SimulationSessionState state = sessions.get(sessionID);
        return state == null ? null : state.peekPrecomputedChunk();
    }

    private byte[] computeOnDemand(Simulation simulation) {
        if (!computeSlots.tryAcquire()) {
            throw new SessionCapacityExceededException("Simulator compute capacity is busy");
        }
        try {
            return computeChunkBytes(simulation);
        } finally {
            computeSlots.release();
        }
    }

    private CompletableFuture<byte[]> startPrecompute(Simulation simulation) {
        if (!computeSlots.tryAcquire()) return null;
        CompletableFuture<byte[]> result = new CompletableFuture<>();
        try {
            // Do not use supplyAsync: cancelling its future before execution skips
            // the supplier (including its finally), leaking the reserved slot.
            precomputeExecutor.execute(() -> {
                byte[] payload = null;
                Throwable failure = null;
                try {
                    if (!result.isCancelled()) payload = computeChunkBytes(simulation);
                } catch (Throwable e) {
                    failure = e;
                } finally {
                    // Cancellation never releases early while work is still running.
                    computeSlots.release();
                }
                if (failure == null) result.complete(payload);
                else result.completeExceptionally(failure);
            });
        } catch (RuntimeException e) {
            computeSlots.release();
            // Executor shutdown cannot invalidate a successfully computed chunk.
            return null;
        }
        return result;
    }

    @PreDestroy
    void shutdown() {
        // Let queued tasks execute their finally blocks and release reservations.
        precomputeExecutor.shutdown();
    }

    private byte[] computeChunkBytes(Simulation simulation) {
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
        long now = currentTimeMillis.getAsLong();
        for (Map.Entry<String, SimulationSessionState> entry : sessions.entrySet()) {
            String sessionID = entry.getKey();
            SimulationSessionState state = entry.getValue();
            SimulationSessionState.Closure closure =
                    state.closeIfIdle(now, IDLE_TIMEOUT_MS);
            if (!closure.closedNow()) {
                continue;
            }
            if (sessions.remove(sessionID, state)) sessionSlots.release();
            cancelPrecompute(closure.pendingPrecompute());
            logger.info("Evicted idle simulation {}", sessionID);
        }
    }
}
