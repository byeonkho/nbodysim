package personal.spacesim.simulation;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;
import personal.spacesim.utils.math.integrators.DP853Integrator;
import personal.spacesim.utils.math.integrators.Integrator;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static personal.spacesim.simulation.state.GlobalState.COORDS_PER_BODY;

@Getter
@Slf4j
public class Simulation {

    private final String sessionID;
    private Frame frame;
    private List<CelestialBodyWrapper> celestialBodies;
    private AbsoluteDate simStartDate;
    private AbsoluteDate simCurrentDate;
    private Integrator integrator;
    private final NBodyDerivatives derivatives;
    private String timeStepUnit;
    private boolean hasEmittedInitialFrame = false;
    private static final int TIMESTEPS_TO_RUN = 10_000;

    /**
     * Fixed-step path (Euler, RK4): emit every Nth integration step
     * (1 = no thinning). Computed by the HTTP boundary from request
     * {@code keyframeIntervalSec / stepDt} and validated to
     * {@code 1..MAX_KEYFRAMES_PER_KEPT} before reaching this ctor.
     * Ignored when the integrator is {@link DP853Integrator} — DP853
     * uses time-gap thinning to {@link #targetSnapshotsPerChunk} instead.
     */
    private final int keyframesPerKept;

    /**
     * Adaptive path (DP853): target snapshot count per chunk. The
     * emission cadence ({@link #targetGapSeconds}) is derived from this
     * and {@code chunk_duration} so the actual count lands within a few
     * percent of N regardless of how dense Hipparchus's internal substep
     * subdivision becomes. Bounds wire size by construction; replaces
     * the old add-mode "emit every accepted substep + throw if over
     * budget" model. Ignored for fixed-step integrators.
     */
    private final int targetSnapshotsPerChunk;

    /**
     * Pre-computed at construction from {@code chunk_duration /
     * (targetSnapshotsPerChunk - 1)} for DP853. Stored so the inner
     * substep handler doesn't recompute per call. 0.0 for fixed-step
     * integrators (path never reads it).
     */
    private final double targetGapSeconds;

    /**
     * True when the live integrator is adaptive (DP853). Cached once at
     * construction so {@link #run} doesn't pay an instanceof per step.
     */
    private final boolean isAdaptiveIntegrator;

    /**
     * Monotonic step counter spanning all run() invocations on this
     * Simulation. Drives the cross-chunk-continuous thinning decision
     * for the fixed-step path.
     */
    private long globalStepCount = 0;

    /**
     * Fixed-step path: next globalStepCount at which the snapshot
     * should be kept. Set to keyframesPerKept on first chunk (right
     * after the initial frame is emitted at step 0) and incremented by
     * keyframesPerKept on each kept step. Surviving as a field across
     * run() calls is what guarantees chunk N+1's first kept step lands
     * exactly K steps after chunk N's last kept step — no boundary gap.
     */
    private long nextKeptAtStep = 0;

    /**
     * Adaptive path: number of emissions made so far (initial + scheduled
     * targets). Surviving across run() invocations preserves smooth
     * cadence across chunk seams.
     *
     * <p>Used to recompute {@link #nextEmitTarget} absolutely from
     * {@link #simStartDate} on each emission, rather than incrementing
     * the previous target by gap. Incremental {@code shiftedBy(gap)}
     * accumulates float rounding error over N-1 iterations; for N=5000
     * with weekly chunks that drift was enough to push the final target
     * a sliver past chunk_end and lose one emission per chunk (off-by-one
     * regression caught at test time).
     */
    private long adaptiveEmitCount = 0;

    /**
     * Adaptive path: timestamp of the NEXT scheduled emission, computed
     * as {@code simStartDate.shiftedBy(adaptiveEmitCount * targetGapSeconds)}.
     * Emit when a substep's evaluator can produce state at this time
     * (i.e. target falls within the current substep's [prev, curr]
     * interval), then bump {@code adaptiveEmitCount} and recompute.
     */
    private AbsoluteDate nextEmitTarget;

    /**
     * Adaptive path telemetry: number of accepted substeps observed
     * during the current chunk's {@link #run}. Reset at the top of
     * each {@code run()} call. Increments on each substep handler
     * invocation (Hipparchus only fires that callback on accepted
     * steps).
     */
    private long acceptedSubstepCount = 0;

    /**
     * Adaptive path telemetry: total sim-time duration of accepted
     * substeps during the current chunk's {@link #run}, in seconds.
     * Reset at the top of each {@code run()} call. Divided by
     * {@link #acceptedSubstepCount} to produce {@code avgStepSeconds}.
     */
    private double acceptedSubstepDurationSeconds = 0.0;

    /**
     * Live state vector, advanced once per timestep. Carries position +
     * velocity for all bodies in the same flat layout as {@link GlobalState}.
     * Replaced each step by swap with {@link #nextStateBuffer} (so the
     * integrator can write into a scratch and we never reallocate). Index
     * {@code i*6..i*6+5} = (x, y, z, vx, vy, vz) for body i.
     */
    private double[] currentStateBuffer;
    private double[] nextStateBuffer;

    /**
     * Cached index of the Sun in {@link #celestialBodies} for snapshot
     * Sun-relative shifting; -1 if no Sun is in the system.
     */
    private final int sunIndex;

    /**
     * Total mechanical energy of the system at {@link #simStartDate},
     * computed once at construction. Used as the denominator in
     * per-emission ΔE/E₀. Guard against |e0| ≈ 0 in readers (physically
     * impossible for any bound system but worth defending against
     * synthetic test inputs).
     */
    private final double e0;

    /**
     * Number of leading massive bodies in {@link #celestialBodies}. The
     * remainder are test particles — they feel gravity from the massive
     * prefix but exert none. Equals {@code celestialBodies.size()} when
     * no test particles are present.
     */
    private final int massiveCount;

    /** Backwards-compatible: all bodies treated as massive. */
    public Simulation(
            String sessionID,
            List<CelestialBodyWrapper> celestialBodies,
            Frame frame,
            Integrator integrator,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            int keyframesPerKept,
            int targetSnapshotsPerChunk
    ) {
        this(sessionID, celestialBodies, frame, integrator, simStartDate,
             timeStepUnit, keyframesPerKept, targetSnapshotsPerChunk,
             celestialBodies.size());
    }

    public Simulation(
            String sessionID,
            List<CelestialBodyWrapper> celestialBodies,
            Frame frame,
            Integrator integrator,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            int keyframesPerKept,
            int targetSnapshotsPerChunk,
            int massiveCount
    ) {
        this.sessionID = sessionID;
        this.frame = frame;
        this.celestialBodies = celestialBodies;
        this.integrator = integrator;
        this.simStartDate = simStartDate;
        this.simCurrentDate = simStartDate;
        this.timeStepUnit = timeStepUnit;
        this.keyframesPerKept = keyframesPerKept;
        this.targetSnapshotsPerChunk = targetSnapshotsPerChunk;
        this.massiveCount = massiveCount;
        this.derivatives = NBodyDerivatives.forBodies(celestialBodies, massiveCount);
        this.isAdaptiveIntegrator = integrator instanceof DP853Integrator;

        // Pre-compute the time-gap (sim seconds between adjacent emissions)
        // from N and the per-chunk duration. (N-1) gaps span N samples.
        // Only meaningful for the adaptive path; 0.0 otherwise.
        double chunkDurationSeconds = TIMESTEPS_TO_RUN * convertTimeStep(timeStepUnit);
        this.targetGapSeconds = isAdaptiveIntegrator && targetSnapshotsPerChunk > 1
                ? chunkDurationSeconds / (targetSnapshotsPerChunk - 1)
                : 0.0;

        // Pack initial wrapper state into the buffer once. After this, the
        // wrappers are no longer kept in sync with the integrator state —
        // their position/velocity fields are stale by design (snapshot reads
        // pull straight from currentStateBuffer instead).
        GlobalState initial = GlobalState.pack(celestialBodies);
        this.currentStateBuffer = initial.data().clone();
        this.nextStateBuffer = new double[currentStateBuffer.length];

        // Cache Sun index so snapshot Sun-relative shifting doesn't re-search
        // the body list every timestep.
        int sunIdx = -1;
        for (int i = 0; i < celestialBodies.size(); i++) {
            if (celestialBodies.get(i).getName().equalsIgnoreCase("sun")) {
                sunIdx = i;
                break;
            }
        }
        this.sunIndex = sunIdx;

        // E₀ captured from the initial state. Stored absolute so per-
        // emission readers can compute (E - e0) / |e0| with the
        // guard-against-zero rule at the call site.
        this.e0 = derivatives.totalEnergy(currentStateBuffer);
    }

    /**
     * Captured at the top of {@link #update()} so the substep handler can
     * map Hipparchus's per-step relative times back into absolute dates.
     */
    private AbsoluteDate stepStartDate;

    private void update() {
        double deltaTimeSeconds = convertTimeStep(timeStepUnit);
        stepStartDate = simCurrentDate;
        simCurrentDate = simCurrentDate.shiftedBy(deltaTimeSeconds);

        integrator.stepInto(nextStateBuffer, currentStateBuffer, deltaTimeSeconds, derivatives);

        // Swap — the just-written nextStateBuffer becomes "current" for the
        // next snapshot/step; the old current is recycled as the new "next".
        double[] tmp = currentStateBuffer;
        currentStateBuffer = nextStateBuffer;
        nextStateBuffer = tmp;
    }

    public ChunkResult run() {
        long startTime = System.nanoTime();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> results = new LinkedHashMap<>();
        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();

        // Reset per-chunk DP853 telemetry counters.
        acceptedSubstepCount = 0;
        acceptedSubstepDurationSeconds = 0.0;
        long evalCountAtStart = integrator.getEvaluationCount();

        // Adaptive integrators (DP853): every accepted substep gives us
        // an interpolator-backed window [stepStart+prev, stepStart+curr]
        // over which we can compute state at any time. We emit at EXACT
        // scheduled target times (not at substep boundaries) by
        // interpolating — produces uniformly-time-spaced samples
        // regardless of how DP853 chose its substep cadence. Critical
        // for Trail.tsx and other integer-index consumers that assume
        // uniform spacing. Fixed-step integrators register but never
        // fire (no substeps).
        integrator.setSubstepHandler((prevTimeSec, currTimeSec, eval) -> {
            // Telemetry: every accepted substep — count + duration.
            acceptedSubstepCount++;
            acceptedSubstepDurationSeconds += (currTimeSec - prevTimeSec);

            while (nextEmitTarget != null) {
                double targetRelTime = nextEmitTarget.durationFrom(stepStartDate);
                // Strictly past the substep's window — wait for a later
                // substep (or a later external step's substeps).
                if (targetRelTime > currTimeSec) {
                    break;
                }
                // Clamp to prevTime for the rare case where a target
                // slipped between substeps (shouldn't happen with
                // correct accounting, but eval requires t in interval).
                double evalT = Math.max(targetRelTime, prevTimeSec);
                double[] evaluatedState = eval.stateAt(evalT);
                results.put(nextEmitTarget, snapshotFromState(evaluatedState));
                deltaE.put(nextEmitTarget, computeDeltaE(evaluatedState));
                adaptiveEmitCount++;
                nextEmitTarget = simStartDate.shiftedBy(
                        adaptiveEmitCount * targetGapSeconds);
            }
        });

        try {
            // Initial frame is always kept (step 0). Only on the first chunk.
            if (!hasEmittedInitialFrame) {
                results.put(simCurrentDate, snapshotFromState(currentStateBuffer));
                deltaE.put(simCurrentDate, computeDeltaE(currentStateBuffer));
                hasEmittedInitialFrame = true;
                nextKeptAtStep = keyframesPerKept;
                // Initial counts as emission #1; next target at #2's tick.
                adaptiveEmitCount = 1;
                nextEmitTarget = simStartDate.shiftedBy(
                        adaptiveEmitCount * targetGapSeconds);
            }

            int currentTimeStep = 0;
            while (currentTimeStep < TIMESTEPS_TO_RUN) {
                update();
                globalStepCount++;

                // Fixed-step path: keyframesPerKept thinning. The adaptive
                // path is driven entirely by the substep handler above —
                // no external-boundary check needed because t==dt substeps
                // are no longer suppressed.
                if (!isAdaptiveIntegrator
                        && globalStepCount >= nextKeptAtStep) {
                    results.put(simCurrentDate, snapshotFromState(currentStateBuffer));
                    deltaE.put(simCurrentDate, computeDeltaE(currentStateBuffer));
                    nextKeptAtStep += keyframesPerKept;
                }
                currentTimeStep++;
            }
        } finally {
            // Clear so the captured `results` reference does not outlive
            // this chunk via the integrator's retained handler field.
            integrator.setSubstepHandler(null);
        }

        long endTime = System.nanoTime();
        double totalTimeSeconds = (endTime - startTime) / 1_000_000_000.0;

        log.info("Simulation completed for {} {} in {} seconds.", TIMESTEPS_TO_RUN, timeStepUnit, totalTimeSeconds);
        log.info("Simulation ran using frame: {}", frame.getName());

        Dp853Telemetry telemetry = null;
        if (isAdaptiveIntegrator && acceptedSubstepCount > 0) {
            long evalsThisChunk = integrator.getEvaluationCount() - evalCountAtStart;
            double estimatedAttempts =
                    estimateDp853Attempts(evalsThisChunk, TIMESTEPS_TO_RUN);
            double acceptRate = estimatedAttempts > 0
                    ? Math.min(1.0, acceptedSubstepCount / estimatedAttempts)
                    : 1.0;
            double avgStep = acceptedSubstepDurationSeconds / acceptedSubstepCount;
            telemetry = new Dp853Telemetry(avgStep, acceptRate);
        }

        return new ChunkResult(results, deltaE, telemetry);
    }

    /**
     * Estimates DP853's attempted-step count for a chunk from its
     * derivative-evaluation total. Hipparchus 3.0's DormandPrince853
     * evaluates 15 stages per attempt (the 12-stage tableau plus 3
     * dense-output stages folded into the main loop), accepted or
     * rejected, plus one initIntegration evaluation per integrate() call;
     * the initializeStep probe is skipped because stepInto seeds the
     * previous accepted step size (the first-ever call pays one extra
     * evaluation, negligible across a chunk). One external step is one
     * integrate() call. The constant must be re-derived on a Hipparchus
     * upgrade.
     */
    static double estimateDp853Attempts(long evalsThisChunk, int externalSteps) {
        return (evalsThisChunk - (double) externalSteps) / 15.0;
    }

    /**
     * Relative energy drift {@code (E - e0) / |e0|} at the given state.
     * Guards against a degenerate |e0| ≈ 0 (would only occur in
     * synthetic test inputs — any bound system has strictly negative
     * E₀) by returning 0.0 to keep the wire format well-defined.
     */
    private double computeDeltaE(double[] state) {
        double absE0 = Math.abs(e0);
        if (absE0 < 1e-30) {
            return 0.0;
        }
        return (derivatives.totalEnergy(state) - e0) / absE0;
    }

    /**
     * Build a snapshot list directly from the given flat state vector.
     * Sun-relative shifting (so the rendered Sun stays anchored at origin)
     * is done component-wise on primitive doubles — only the final two
     * Vector3D constructions inside each {@link CelestialBodySnapshot} are
     * unavoidable, since the snapshot record is the public wire format.
     *
     * <p>The state argument lets external-step keyframes use the live
     * {@code currentStateBuffer} while substep callbacks can pass through
     * Hipparchus's transient interpolator state directly.
     */
    private List<CelestialBodySnapshot> snapshotFromState(double[] data) {
        double sunX = 0, sunY = 0, sunZ = 0;
        double sunVx = 0, sunVy = 0, sunVz = 0;
        if (sunIndex >= 0) {
            int sunBase = sunIndex * COORDS_PER_BODY;
            sunX  = data[sunBase];
            sunY  = data[sunBase + 1];
            sunZ  = data[sunBase + 2];
            sunVx = data[sunBase + 3];
            sunVy = data[sunBase + 4];
            sunVz = data[sunBase + 5];
        }

        int n = celestialBodies.size();
        List<CelestialBodySnapshot> copy = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            int base = i * COORDS_PER_BODY;
            copy.add(new CelestialBodySnapshot(
                    celestialBodies.get(i).getName(),
                    new org.hipparchus.geometry.euclidean.threed.Vector3D(
                            data[base]     - sunX,
                            data[base + 1] - sunY,
                            data[base + 2] - sunZ),
                    new org.hipparchus.geometry.euclidean.threed.Vector3D(
                            data[base + 3] - sunVx,
                            data[base + 4] - sunVy,
                            data[base + 5] - sunVz)
            ));
        }
        return copy;
    }

    private double convertTimeStep(String timeStepUnit) {
        return switch (timeStepUnit.toLowerCase()) {
            case "seconds" -> 1;
            case "hours" -> PhysicsConstants.SECONDS_PER_HOUR;
            case "days" -> PhysicsConstants.SECONDS_PER_DAY;
            case "weeks" -> PhysicsConstants.SECONDS_PER_WEEK;
            default -> throw new IllegalArgumentException("Unsupported time step unit: " + timeStepUnit);
        };
    }
}
