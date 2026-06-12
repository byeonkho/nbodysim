package personal.spacesim.simulation.state;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.utils.math.integrators.DP853Integrator;
import personal.spacesim.utils.math.integrators.EulerIntegrator;
import personal.spacesim.utils.math.integrators.Integrator;
import personal.spacesim.utils.math.integrators.RK4Integrator;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NBodyDerivativesEnergyTest {

    private static final double G = PhysicsConstants.GRAVITATIONAL_CONSTANT;

    @Test
    void loneBodyHasOnlyKineticEnergy() {
        // One body, mass M, velocity (vx, 0, 0). T = 0.5·M·vx². U = 0
        // (no pairs). E = T.
        double M = 1e24;
        double vx = 1e3;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * M});

        double[] state = {0, 0, 0, vx, 0, 0};
        double e = derivs.totalEnergy(state);

        double expected = 0.5 * M * vx * vx;
        assertEquals(expected, e, Math.abs(expected) * 1e-12);
    }

    @Test
    void twoBodiesAtRestHavePurePotentialEnergy() {
        // Two equal masses M at separation r, both at rest. T = 0.
        // U = -G·M·M / r.
        double M = 1e24;
        double r = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * M, G * M});

        double[] state = {
                0, 0, 0, 0, 0, 0,
                r, 0, 0, 0, 0, 0,
        };
        double e = derivs.totalEnergy(state);

        double expected = -PhysicsConstants.GRAVITATIONAL_CONSTANT * M * M / r;
        assertEquals(expected, e, Math.abs(expected) * 1e-12);
    }

    @Test
    void energyInvariantUnderRigidTranslation() {
        // Shifting both bodies by the same vector leaves both T and U
        // unchanged. Confirms the formula isn't accidentally using
        // absolute position instead of pairwise separation.
        double M = 1e24;
        double r = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * M, G * M});

        double[] origin = {
                0, 0, 0, 100, 0, 0,
                r, 0, 0, -50, 0, 0,
        };
        double[] shifted = {
                1e9, 2e9, 3e9, 100, 0, 0,
                r + 1e9, 2e9, 3e9, -50, 0, 0,
        };
        double eOrigin = derivs.totalEnergy(origin);
        double eShifted = derivs.totalEnergy(shifted);

        assertEquals(eOrigin, eShifted, Math.abs(eOrigin) * 1e-12);
    }

    @Test
    void rejectsMismatchedStateLength() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * 1e24, G * 1e24});
        // state has 1 body but derivs is configured for 2
        double[] tooShort = {0, 0, 0, 0, 0, 0};
        assertThrows(IllegalArgumentException.class, () -> derivs.totalEnergy(tooShort));
    }

    @Test
    void integratorDriftStaysWithinExpectedBounds() {
        // Earth-mass body in circular orbit around Sun at 1 AU. Run
        // each integrator for 1000 daily steps (~3 years) and check
        // |ΔE/E₀| stays within the integrator's typical drift envelope.
        // Thresholds are conservative — actual values are usually
        // 10–100× better, but the bounds catch any regression that
        // makes an integrator visibly broken.
        double sunMass = 1.989e30;
        double earthMass = 5.972e24;
        double au = 1.495978707e11;
        // v for circular orbit: v = sqrt(G·M_sun / r)
        double vCircular = Math.sqrt(
                PhysicsConstants.GRAVITATIONAL_CONSTANT * sunMass / au);

        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * sunMass, G * earthMass});

        double[] initialState = {
                0, 0, 0,                    // Sun position
                0, 0, 0,                    // Sun velocity
                au, 0, 0,                   // Earth position
                0, vCircular, 0,            // Earth velocity (circular orbit)
        };
        double e0 = derivs.totalEnergy(initialState);
        double absE0 = Math.abs(e0);

        double dt = 86_400.0;  // 1 day
        int steps = 100;       // ~3 sim-months. Long enough for drift to register,
                               // short enough that Euler doesn't spiral wildly out.

        // Threshold per integrator: Euler is allowed to drift visibly;
        // RK4 should stay tight; DP853 should be near machine precision.
        // Bounds are alarms for regressions, not target values — actual
        // drift is typically 10–100× better.
        // Euler drift on a 1 AU orbit @ 1-day dt: ~6% per 100 steps in practice.
        // Bound at 10% gives ~2× headroom — regression alarm, not target value.
        assertEnergyDriftBounded(new EulerIntegrator(), derivs, initialState.clone(), dt, steps, absE0, e0, 1e-1);
        assertEnergyDriftBounded(new RK4Integrator(),   derivs, initialState.clone(), dt, steps, absE0, e0, 1e-7);
        assertEnergyDriftBounded(new DP853Integrator(), derivs, initialState.clone(), dt, steps, absE0, e0, 1e-10);
    }

    private static void assertEnergyDriftBounded(
            Integrator integrator,
            NBodyDerivatives derivs,
            double[] state,
            double dt,
            int steps,
            double absE0,
            double e0,
            double bound
    ) {
        double[] next = new double[state.length];
        for (int i = 0; i < steps; i++) {
            integrator.stepInto(next, state, dt, derivs);
            double[] tmp = state;
            state = next;
            next = tmp;
        }
        double eFinal = derivs.totalEnergy(state);
        double drift = Math.abs((eFinal - e0) / absE0);
        assertTrue(
                drift < bound,
                String.format(
                        "%s drift %.3e exceeds bound %.3e",
                        integrator.getClass().getSimpleName(), drift, bound));
    }
}
