package personal.spacesim.services;

import personal.spacesim.simulation.Simulation;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Owns every mutable value whose validity is tied to one live simulation
 * session. Synchronized methods form the short lifecycle boundary for touch,
 * reservation, publication, and closure. Expensive chunk production runs
 * outside this monitor under {@link #requestLock}, then publishes only if the
 * state is still open.
 */
final class SimulationSessionState {

    record ChunkReservation(
            byte[] retryPayload,
            CompletableFuture<byte[]> precomputedChunk
    ) {
        static ChunkReservation retry(byte[] payload) {
            return new ChunkReservation(payload, null);
        }

        static ChunkReservation produce(CompletableFuture<byte[]> precomputedChunk) {
            return new ChunkReservation(null, precomputedChunk);
        }

        boolean isRetry() {
            return retryPayload != null;
        }
    }

    record Closure(
            boolean closedNow,
            CompletableFuture<byte[]> pendingPrecompute
    ) {
        static Closure noChange() {
            return new Closure(false, null);
        }
    }

    private final Simulation simulation;
    private final ReentrantLock requestLock = new ReentrantLock();
    private long lastAccessedAt;
    private int servedChunkIndex = -1;
    private byte[] lastChunkBytes;
    private CompletableFuture<byte[]> nextChunkFuture;
    private boolean closed;

    SimulationSessionState(Simulation simulation, long createdAt) {
        this.simulation = Objects.requireNonNull(simulation);
        this.lastAccessedAt = createdAt;
    }

    ReentrantLock requestLock() {
        return requestLock;
    }

    Simulation simulationForWork() {
        return simulation;
    }

    synchronized Simulation liveSimulation() {
        return closed ? null : simulation;
    }

    synchronized boolean touchIfOpen(long now) {
        if (closed) {
            return false;
        }
        lastAccessedAt = now;
        return true;
    }

    synchronized ChunkReservation reserveChunk(int expectedChunkIndex) {
        ensureOpen();
        if (expectedChunkIndex == servedChunkIndex) {
            if (lastChunkBytes != null) {
                return ChunkReservation.retry(lastChunkBytes);
            }
            throw new ChunkIndexConflictException(expectedChunkIndex, servedChunkIndex);
        }
        if (expectedChunkIndex != servedChunkIndex + 1) {
            throw new ChunkIndexConflictException(expectedChunkIndex, servedChunkIndex);
        }
        CompletableFuture<byte[]> precomputed = nextChunkFuture;
        nextChunkFuture = null;
        return ChunkReservation.produce(precomputed);
    }

    synchronized boolean publishChunk(
            int chunkIndex,
            byte[] payload,
            Supplier<CompletableFuture<byte[]>> nextFutureFactory
    ) {
        if (closed) {
            return false;
        }
        // Speculation is optional when the global compute budget is occupied.
        CompletableFuture<byte[]> next = nextFutureFactory.get();
        servedChunkIndex = chunkIndex;
        lastChunkBytes = payload;
        nextChunkFuture = next;
        return true;
    }

    synchronized Closure close() {
        if (closed) {
            return Closure.noChange();
        }
        return closeInternal();
    }

    synchronized Closure closeIfIdle(long now, long idleTimeoutMs) {
        if (closed || now - lastAccessedAt <= idleTimeoutMs) {
            return Closure.noChange();
        }
        return closeInternal();
    }

    synchronized CompletableFuture<byte[]> peekPrecomputedChunk() {
        return closed ? null : nextChunkFuture;
    }

    private Closure closeInternal() {
        closed = true;
        CompletableFuture<byte[]> pending = nextChunkFuture;
        nextChunkFuture = null;
        servedChunkIndex = -1;
        lastChunkBytes = null;
        return new Closure(true, pending);
    }

    private void ensureOpen() {
        if (closed) {
            throw new SessionNotFoundException("Session is closed");
        }
    }
}
