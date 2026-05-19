package personal.spacesim.utils.math.integrators;

import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

/**
 * Steps an N-body system's global state forward in time by a given dt,
 * given a derivatives function.
 *
 * <p>Implementations differ in numerical accuracy and computational cost:
 * <ul>
 *   <li>{@link EulerIntegrator}: 1 derivative evaluation per step,
 *       first-order accuracy</li>
 *   <li>{@link RK4Integrator}: 4 evaluations per step, fourth-order</li>
 *   <li>{@link DP853Integrator}: adaptive step sizing, eighth-order
 *       accuracy with embedded error estimate (via Hipparchus)</li>
 * </ul>
 *
 * <p>Sealed so the compiler can enforce exhaustive handling downstream
 * (e.g. UI dropdowns, factory mappings).
 *
 * <p>Implementations are stateful (hold scratch arrays as fields). One
 * {@code Integrator} instance per {@code Simulation} — do not share across
 * concurrent simulations.
 */
public sealed interface Integrator
    permits EulerIntegrator, RK4Integrator, DP853Integrator {

    /**
     * Mutating-output variant. Writes the next state into {@code out} given
     * the current {@code state} (raw flat array layout matching
     * {@link GlobalState#data()}).
     *
     * <p>Hot path: called once per timestep, ~10K times per chunk. Implementations
     * own scratch buffers (allocated lazily on first call, sized to match the
     * input dimension) so this method allocates nothing once warmed up.
     *
     * <p>{@code out} and {@code state} must NOT alias — implementations may
     * read {@code state} multiple times after writing to {@code out}.
     */
    void stepInto(double[] out, double[] state, double dt, NBodyDerivatives derivatives);

    /**
     * Allocating wrapper around {@link #stepInto}. Convenient for tests and
     * one-shot calls; not for hot loops.
     */
    default GlobalState step(GlobalState state, double dt, NBodyDerivatives derivatives) {
        double[] result = new double[state.data().length];
        stepInto(result, state.data(), dt, derivatives);
        return new GlobalState(result, state.bodyCount());
    }

    /**
     * Register a {@link SubstepHandler} to receive accepted intermediate
     * substeps for each subsequent {@code stepInto} call. Pass {@code null}
     * to clear.
     *
     * <p>Default is a no-op: fixed-step integrators (Euler, RK4) take a
     * single step per call and have no intermediate substeps to expose.
     * Only {@link DP853Integrator} overrides this to delegate Hipparchus's
     * step-handler events.
     */
    default void setSubstepHandler(SubstepHandler handler) {
        // no-op for fixed-step integrators
    }

    /**
     * Total number of derivative evaluations performed across all
     * {@code stepInto} calls on this instance. Used by
     * {@link personal.spacesim.simulation.Simulation} to estimate
     * DP853's attempted-step count (and thus accept rate) without
     * subclassing Hipparchus internals.
     *
     * <p>Default 0 for fixed-step integrators (Euler, RK4) — they don't
     * track this and their accept rate is unconditionally 1.0 by
     * construction. Only {@link DP853Integrator} overrides.
     */
    default long getEvaluationCount() {
        return 0;
    }
}
