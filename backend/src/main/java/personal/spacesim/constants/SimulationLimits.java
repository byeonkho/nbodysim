package personal.spacesim.constants;

/**
 * Numeric guardrails for simulation request inputs. Centralized so the
 * controller validation and any future frontend mirror reference the
 * same source of truth.
 */
public final class SimulationLimits {

    private SimulationLimits() {}

    /**
     * Maximum value of {@code keyframesPerKept} (K) accepted at /initialize
     * for fixed-step integrators (Euler, RK4). With CHUNK_SIZE=10000
     * timesteps, K=100 still leaves ~100 keyframes per chunk — the
     * visual-smoothness floor for Hermite interpolation between samples.
     * Higher values risk visibly under-sampled motion even with cubic
     * interpolation.
     *
     * <p>Not used by DP853, which is on the Mode C time-gap path
     * ({@code targetSnapshotsPerChunk}) instead.
     */
    public static final int MAX_KEYFRAMES_PER_KEPT = 100;
}
