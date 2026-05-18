package personal.spacesim.utils.math.integrators;

/**
 * Callback for accepted substeps from an adaptive integrator. Receives the
 * substep's time interval {@code [prevTimeSec, currTimeSec]} plus an
 * {@link IntermediateStateEvaluator} that interpolates the state at any
 * point within that interval.
 *
 * <p>Today only {@link DP853Integrator} fires substep events — Hipparchus's
 * adaptive solver subdivides each {@code stepInto} call as needed to keep
 * local error within tolerance, and surfaces every accepted subdivision
 * through this hook. Fixed-step integrators (Euler, RK4) never invoke this.
 *
 * <p>Implementations decide WHAT time within {@code [prevTimeSec, currTimeSec]}
 * to emit at — typically a scheduled gap-tick — and use the evaluator to
 * pull state at that exact time. This produces uniformly-time-spaced
 * emissions independent of the integrator's adaptive substep cadence,
 * which matters because downstream consumers (Trail.tsx, etc.) iterate
 * the buffer by integer index and assume uniform-time samples.
 *
 * <p>The evaluator and any returned state arrays are owned by the
 * integrator — callbacks must read or copy what they need before returning.
 */
@FunctionalInterface
public interface SubstepHandler {

    /**
     * @param prevTimeSec  start of this substep interval, in seconds
     *                     relative to the start of the current
     *                     {@code stepInto} call ({@code 0} for the first
     *                     substep)
     * @param currTimeSec  end of this substep interval, in seconds
     *                     ({@code currTimeSec > prevTimeSec})
     * @param eval         interpolates state at any time within the
     *                     interval; transient — do not retain after the
     *                     callback returns
     */
    void onSubstep(double prevTimeSec, double currTimeSec, IntermediateStateEvaluator eval);
}
