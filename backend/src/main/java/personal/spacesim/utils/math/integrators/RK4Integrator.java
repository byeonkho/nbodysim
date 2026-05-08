package personal.spacesim.utils.math.integrators;

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
 */
public final class RK4Integrator implements Integrator {

    /** Lazily-allocated scratch buffers, reused across steps. */
    private double[] k1, k2, k3, k4, scratch;

    @Override
    public void stepInto(double[] out, double[] state, double dt, NBodyDerivatives derivatives) {
        ensureScratch(state.length);

        // k1 = f(state)
        derivatives.derivativesInto(k1, state);

        // scratch = state + dt/2 * k1; k2 = f(scratch)
        final double halfDt = dt / 2.0;
        for (int i = 0; i < state.length; i++) {
            scratch[i] = state[i] + halfDt * k1[i];
        }
        derivatives.derivativesInto(k2, scratch);

        // scratch = state + dt/2 * k2; k3 = f(scratch)
        for (int i = 0; i < state.length; i++) {
            scratch[i] = state[i] + halfDt * k2[i];
        }
        derivatives.derivativesInto(k3, scratch);

        // scratch = state + dt * k3; k4 = f(scratch)
        for (int i = 0; i < state.length; i++) {
            scratch[i] = state[i] + dt * k3[i];
        }
        derivatives.derivativesInto(k4, scratch);

        // out = state + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
        final double sixthDt = dt / 6.0;
        for (int i = 0; i < state.length; i++) {
            out[i] = state[i] + sixthDt * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
        }
    }

    private void ensureScratch(int len) {
        if (k1 == null || k1.length != len) {
            k1 = new double[len];
            k2 = new double[len];
            k3 = new double[len];
            k4 = new double[len];
            scratch = new double[len];
        }
    }
}
