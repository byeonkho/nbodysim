package personal.spacesim.utils.math.integrators;

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

    /** Lazily-allocated scratch for k = f(state); reused across steps. */
    private double[] kScratch;

    @Override
    public void stepInto(double[] out, double[] state, double dt, NBodyDerivatives derivatives) {
        if (kScratch == null || kScratch.length != state.length) {
            kScratch = new double[state.length];
        }
        derivatives.derivativesInto(kScratch, state);
        for (int i = 0; i < state.length; i++) {
            out[i] = state[i] + dt * kScratch[i];
        }
    }
}
