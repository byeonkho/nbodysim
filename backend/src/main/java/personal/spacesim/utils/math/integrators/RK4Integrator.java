package personal.spacesim.utils.math.integrators;

import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

/**
 * Classical fourth-order Runge–Kutta integrator.
 *
 * <p>Step rule:
 * <pre>
 *   k1 = f(y_n)
 *   k2 = f(y_n + dt/2 * k1)
 *   k3 = f(y_n + dt/2 * k2)
 *   k4 = f(y_n + dt   * k3)
 *   y_{n+1} = y_n + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
 * </pre>
 *
 * <p>Four derivative evaluations per step; fourth-order local accuracy.
 * Substantially better than Euler for the same step size — drift over a
 * long-horizon sim is much smaller. Costs roughly 4× per step but a step
 * of equivalent accuracy can be much larger, so total cost is competitive
 * for accurate sims.
 *
 * <p>Allocates intermediate {@link GlobalState} instances per step; for
 * many-step runs this is the dominant allocation cost. If profiling
 * surfaces it as a bottleneck (P2 perf work), an in-place variant would
 * help.
 */
public final class RK4Integrator implements Integrator {

    @Override
    public GlobalState step(GlobalState state, double dt, NBodyDerivatives derivatives) {
        GlobalState k1 = derivatives.derivatives(state);
        GlobalState k2 = derivatives.derivatives(state.addScaled(k1, dt / 2.0));
        GlobalState k3 = derivatives.derivatives(state.addScaled(k2, dt / 2.0));
        GlobalState k4 = derivatives.derivatives(state.addScaled(k3, dt));

        // y_{n+1} = y_n + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
        return state
            .addScaled(k1, dt / 6.0)
            .addScaled(k2, dt / 3.0)
            .addScaled(k3, dt / 3.0)
            .addScaled(k4, dt / 6.0);
    }
}
