package personal.spacesim.utils.math.integrators;

import org.hipparchus.ode.ODEIntegrator;
import org.hipparchus.ode.ODEState;
import org.hipparchus.ode.OrdinaryDifferentialEquation;
import org.hipparchus.ode.nonstiff.DormandPrince853Integrator;
import personal.spacesim.simulation.state.GlobalState;
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
 * component. Adjust if a faster-but-coarser preset becomes useful.
 */
public final class DP853Integrator implements Integrator {

    private static final double MIN_STEP = 1.0;        // 1 second
    private static final double MAX_STEP = 86_400.0;   // 1 day
    private static final double ABS_TOL  = 1.0e-3;     // 1 mm
    private static final double REL_TOL  = 1.0e-12;

    @Override
    public GlobalState step(GlobalState initial, double dt, NBodyDerivatives derivatives) {
        final int bodyCount = initial.bodyCount();
        final int dimension = initial.data().length;

        // Bridge to Hipparchus's ODE interface: given a flat array of state
        // at substep time t, return the derivative as a flat array.
        OrdinaryDifferentialEquation ode = new OrdinaryDifferentialEquation() {
            @Override
            public int getDimension() {
                return dimension;
            }

            @Override
            public double[] computeDerivatives(double t, double[] y) {
                return derivatives.derivatives(new GlobalState(y, bodyCount)).data();
            }
        };

        // A fresh integrator per step is wasteful (each constructs internal
        // tableaux); profiling may justify hoisting it. P2 perf concern.
        ODEIntegrator integrator =
            new DormandPrince853Integrator(MIN_STEP, MAX_STEP, ABS_TOL, REL_TOL);

        ODEState start = new ODEState(0.0, initial.data());
        ODEState end = integrator.integrate(ode, start, dt);

        return new GlobalState(end.getCompleteState(), bodyCount);
    }
}
