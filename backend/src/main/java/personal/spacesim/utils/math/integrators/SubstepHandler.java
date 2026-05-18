package personal.spacesim.utils.math.integrators;

/**
 * Callback for accepted intermediate substeps from an adaptive integrator.
 *
 * <p>Today only {@link DP853Integrator} fires substep events — Hipparchus's
 * adaptive solver subdivides each {@code stepInto} call as needed to keep
 * local error within tolerance, and surfaces every accepted subdivision
 * through this hook. Fixed-step integrators (Euler, RK4) never invoke this.
 *
 * <p>The final substep at {@code t == dt} is intentionally NOT delivered:
 * that point coincides with the step endpoint that the simulation loop
 * emits on its own, so suppressing it here avoids a duplicate keyframe at
 * every external-step boundary. Implementations therefore only see
 * intermediate substeps, with relative times strictly in {@code (0, dt)}.
 *
 * <p>The {@code substepState} array is owned by the integrator — callbacks
 * must read or copy what they need before returning, not retain a reference.
 */
@FunctionalInterface
public interface SubstepHandler {

    /**
     * @param relativeTimeSec time of this substep relative to the start of
     *                        the current {@code stepInto} call, in seconds
     *                        ({@code 0 < relativeTimeSec < dt})
     * @param substepState    flat state vector at this substep (same layout
     *                        as {@code GlobalState.data()}); transient — do
     *                        not retain after the callback returns
     */
    void onSubstep(double relativeTimeSec, double[] substepState);
}
