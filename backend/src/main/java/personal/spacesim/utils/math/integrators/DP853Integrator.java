package personal.spacesim.utils.math.integrators;

import org.hipparchus.ode.ODEState;
import org.hipparchus.ode.OrdinaryDifferentialEquation;
import org.hipparchus.ode.nonstiff.DormandPrince853Integrator;
import org.hipparchus.ode.sampling.ODEStateInterpolator;
import org.hipparchus.ode.sampling.ODEStepHandler;
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
     * Optional callback receiving each accepted substep. Read inside
     * Hipparchus's step handler — null = nothing to forward.
     */
    private SubstepHandler substepHandler;

    /**
     * Cumulative derivative-evaluation count across all {@link #stepInto}
     * calls on this instance. Hipparchus's {@code getEvaluations()} is
     * per-{@code integrate()}-call (it resets each call), so we accumulate
     * ourselves. Used downstream by {@code Simulation} to estimate the
     * attempted-step count for DP853's accept-rate readout.
     */
    private long cumulativeEvaluations = 0;

    /**
     * Largest accepted substep duration (seconds) observed during the
     * current {@link #stepInto} call. Reset at the top of each call and
     * folded into {@link #seedStepSeconds} afterwards. The max (rather
     * than the last) is used because the final substep of a call is
     * usually truncated to land exactly on dt and would under-seed.
     */
    private double maxAcceptedStepThisCall = 0.0;

    /**
     * Step-size seed for the next {@link #stepInto} call, carried across
     * calls and across chunks (one integrator instance per session). The
     * controller resumes near the previously accepted step instead of
     * re-deriving a rough guess and re-ramping inside every call; each
     * derivative evaluation is the O(N^2) force pass, so cold restarts
     * multiplied the dominant DP853 chunk cost ~6x. 0 until the first
     * call completes.
     */
    private double seedStepSeconds = 0.0;

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

    public DP853Integrator() {
        hipparchusIntegrator.addStepHandler(new ODEStepHandler() {
            @Override
            public void handleStep(ODEStateInterpolator interpolator) {
                double prevTime = interpolator.getPreviousState().getTime();
                double currTime = interpolator.getCurrentState().getTime();
                // Record for next-call step-size seeding regardless of
                // whether a substep consumer is attached. One subtraction,
                // compare, and store per accepted substep, no allocations.
                double accepted = currTime - prevTime;
                if (accepted > maxAcceptedStepThisCall) {
                    maxAcceptedStepThisCall = accepted;
                }
                SubstepHandler h = substepHandler;
                if (h == null) {
                    return;
                }
                // Adapter: forward the per-step interpolator as a typed
                // evaluator. Lifetime is bounded by this callback — the
                // interpolator is reused by Hipparchus on subsequent
                // steps, so the lambda must not be retained.
                IntermediateStateEvaluator eval = (timeSec) ->
                        interpolator.getInterpolatedState(timeSec).getCompleteState();
                h.onSubstep(prevTime, currTime, eval);
            }
        });
    }

    @Override
    public void setSubstepHandler(SubstepHandler handler) {
        this.substepHandler = handler;
    }

    @Override
    public void stepInto(double[] out, double[] state, double dt, NBodyDerivatives derivatives) {
        if (derivScratch == null || derivScratch.length != state.length) {
            derivScratch = new double[state.length];
        }
        currentDerivatives = derivatives;

        // Seed the adaptive controller with the previous call's converged
        // step so it resumes at speed instead of restarting cold (rough
        // 0.01*||y||/||y'|| guess + Euler probe + growth ramp) on every
        // external step. Hipparchus uses an in-range seed directly and
        // skips initializeStep's probe evaluation; out-of-range values
        // fall back to auto, so MIN_STEP/MAX_STEP cannot be violated.
        if (seedStepSeconds > 0) {
            hipparchusIntegrator.setInitialStepSize(Math.min(seedStepSeconds, dt));
        }
        maxAcceptedStepThisCall = 0.0;

        ODEState start = new ODEState(0.0, state);
        ODEState end = hipparchusIntegrator.integrate(ode, start, dt);
        cumulativeEvaluations += hipparchusIntegrator.getEvaluations();
        if (maxAcceptedStepThisCall > 0) {
            seedStepSeconds = maxAcceptedStepThisCall;
        }

        // Hipparchus returns an internal array; copy into caller's buffer.
        System.arraycopy(end.getCompleteState(), 0, out, 0, out.length);
    }

    @Override
    public long getEvaluationCount() {
        return cumulativeEvaluations;
    }
}
