package personal.spacesim.utils.math.integrators;

import org.hipparchus.ode.ODEState;
import org.hipparchus.ode.OrdinaryDifferentialEquation;
import org.hipparchus.ode.nonstiff.DormandPrince853Integrator;
import personal.spacesim.simulation.state.NBodyDerivatives;

/**
 * Adaptive Dormand–Prince 8(5,3) integrator backed by Hipparchus.
 *
 * <p>Eighth-order step with an embedded fifth-order error estimate. The
 * integrator picks its own internal step size based on configured
 * tolerances — large strides through benign regions, small steps near
 * close encounters or rapid acceleration changes — so total cost scales
 * with the problem's actual difficulty rather than a fixed dt.
 *
 * <p>For accurate trajectories over long horizons this is the right
 * choice; for cheap sketchy demos Euler is faster.
 *
 * <p>Tolerances are tuned for solar-system-scale orbits where positions
 * are in metres and velocities in m/s. {@code ABS_TOL = 1e-3} = 1 mm of
 * absolute error tolerance; {@code REL_TOL = 1e-12} for the relative
 * component.
 */
public final class DP853Integrator implements Integrator {

    private static final double MIN_STEP = 1.0;        // 1 second
    private static final double MAX_STEP = 86_400.0;   // 1 day
    private static final double ABS_TOL  = 1.0e-3;     // 1 mm
    private static final double REL_TOL  = 1.0e-12;

    /**
     * Hoisted from the original per-step construction. Reused across all
     * steps in the same Simulation; thread-safe for our usage because each
     * Simulation has its own DP853Integrator instance and chunks run
     * sequentially within a Simulation.
     */
    private final DormandPrince853Integrator hipparchusIntegrator =
        new DormandPrince853Integrator(MIN_STEP, MAX_STEP, ABS_TOL, REL_TOL);

    /**
     * Set immediately before each {@link #stepInto} call, then read by
     * {@link #ode}'s {@code computeDerivatives} on each Hipparchus substep.
     * Field rather than a captured local so {@code ode} can be allocated
     * once and reused.
     */
    private NBodyDerivatives currentDerivatives;

    /**
     * Scratch buffer for derivative output. Returned to Hipparchus from
     * {@code computeDerivatives}; Hipparchus reads its contents and uses
     * its own internal storage afterwards, so reusing is safe.
     */
    private double[] derivScratch;

    /**
     * Reused across steps. Holds {@link #currentDerivatives} and
     * {@link #derivScratch} via closure over the outer instance.
     */
    private final OrdinaryDifferentialEquation ode = new OrdinaryDifferentialEquation() {
        @Override
        public int getDimension() {
            return derivScratch.length;
        }

        @Override
        public double[] computeDerivatives(double t, double[] y) {
            currentDerivatives.derivativesInto(derivScratch, y);
            return derivScratch;
        }
    };

    @Override
    public void stepInto(double[] out, double[] state, double dt, NBodyDerivatives derivatives) {
        if (derivScratch == null || derivScratch.length != state.length) {
            derivScratch = new double[state.length];
        }
        currentDerivatives = derivatives;

        ODEState start = new ODEState(0.0, state);
        ODEState end = hipparchusIntegrator.integrate(ode, start, dt);

        // Hipparchus returns an internal array; copy into caller's buffer.
        System.arraycopy(end.getCompleteState(), 0, out, 0, out.length);
    }
}
