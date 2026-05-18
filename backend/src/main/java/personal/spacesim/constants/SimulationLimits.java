package personal.spacesim.constants;

/**
 * Numeric guardrails for simulation request inputs. Centralized so the
 * controller validation and any future frontend mirror reference the
 * same source of truth.
 */
public final class SimulationLimits {

    private SimulationLimits() {}

    /**
     * Maximum value of {@code keyframesPerKept} (K) accepted at /initialize.
     * With CHUNK_SIZE=10000 timesteps, K=100 still leaves ~100 keyframes
     * per chunk — the visual-smoothness floor for Hermite interpolation
     * between samples. Higher values risk visibly under-sampled motion
     * even with cubic interpolation.
     */
    public static final int MAX_KEYFRAMES_PER_KEPT = 100;

    /**
     * Absolute ceiling on snapshots a single chunk may emit before
     * {@code Simulation.run()} throws
     * {@code ChunkSnapshotBudgetExceededException}. Bounds wire size when
     * DP853's adaptive substep capture surfaces dense bursts of keyframes
     * during close encounters or chaotic scenarios.
     *
     * <p>Set at 2× the Euler K=1 baseline (10001) so DP853 can layer
     * intermediate substeps on top of the regular external-step keyframes
     * without tripping under normal solar-system loads. Wire-size budget
     * scales accordingly: ~20000 × ~10 bodies × ~50 B compressed ≈ 10 MB
     * worst case, vs the rate limiter's nominal 4 MB sizing — acceptable
     * because the ceiling is only approached for chaotic / close-encounter
     * scenarios where the dense resolution is the feature.
     */
    public static final int MAX_SNAPSHOTS_PER_CHUNK = 20_000;
}
