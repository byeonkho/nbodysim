package personal.spacesim.utils.math.integrators;

import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

/**
 * Forward Euler integrator (first-order, explicit).
 *
 * <p>Step rule: {@code y_{n+1} = y_n + dt * f(y_n)}. One derivative
 * evaluation per step; cheapest and least accurate.
 *
 * <p>Useful as a baseline and for visualizing drift — running this on a
 * long-horizon sim shows the accumulating error that higher-order
 * integrators avoid.
 */
public final class EulerIntegrator implements Integrator {

    @Override
    public GlobalState step(GlobalState state, double dt, NBodyDerivatives derivatives) {
        GlobalState dy = derivatives.derivatives(state);
        return state.addScaled(dy, dt);
    }
}
