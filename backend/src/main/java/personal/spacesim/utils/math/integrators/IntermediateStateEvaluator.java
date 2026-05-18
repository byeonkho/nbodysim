package personal.spacesim.utils.math.integrators;

/**
 * Evaluates the integrator's interpolated state at any time within the
 * current substep interval {@code [prevTimeSec, currTimeSec]}.
 *
 * <p>Backed by Hipparchus's per-step interpolator polynomial — already
 * computed during integration, cheap to evaluate. Lets the
 * {@link SubstepHandler} emit snapshots at exact schedule timestamps
 * rather than at substep boundaries, so consumers (Trail.tsx, etc.) see
 * uniformly-time-spaced samples in the buffer regardless of how DP853
 * chose its substep cadence.
 *
 * <p>The returned array is owned by the integrator — callbacks must read
 * or copy what they need before returning, not retain a reference. The
 * evaluator itself is also bounded by the {@code onSubstep} callback's
 * lifetime: do not invoke after the callback returns.
 */
@FunctionalInterface
public interface IntermediateStateEvaluator {

    /**
     * @param timeSec time relative to the start of the current
     *                {@code stepInto} call, in seconds. Must be within
     *                the current substep interval supplied to
     *                {@link SubstepHandler#onSubstep}.
     * @return flat state vector at {@code timeSec} (same layout as
     *         {@code GlobalState.data()}); transient — do not retain.
     */
    double[] stateAt(double timeSec);
}
