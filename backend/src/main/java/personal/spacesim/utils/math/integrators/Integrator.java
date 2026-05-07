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
 *   <li>RK4 (planned, P0.3 phase 3): 4 evaluations per step, fourth-order</li>
 *   <li>DormandPrince853 (planned, P0.3 phase 4): adaptive step sizing,
 *       eighth-order accuracy via Hipparchus</li>
 * </ul>
 *
 * <p>Sealed so the compiler can enforce exhaustive handling downstream
 * (e.g. UI dropdowns, factory mappings). Permits list grows as integrators
 * land.
 */
public sealed interface Integrator permits EulerIntegrator {

    /**
     * Advance {@code state} forward by {@code dt} using {@code derivatives}.
     * Returns a new state — does not mutate the input.
     */
    GlobalState step(GlobalState state, double dt, NBodyDerivatives derivatives);
}
