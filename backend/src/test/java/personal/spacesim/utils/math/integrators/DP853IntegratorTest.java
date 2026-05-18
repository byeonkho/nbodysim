package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DP853IntegratorTest {

    @Test
    void zeroForceSingleBodyAdvancesByDtTimesVelocity() {
        // Single body, no others to attract it. Adaptive solver should
        // recognize the trivial case (constant derivative) and advance in
        // essentially one step — result very close to exact.
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});
        GlobalState state = new GlobalState(new double[]{0, 0, 0, 1, 2, 3}, 1);

        GlobalState next = new DP853Integrator().step(state, 10.0, derivs);

        assertEquals(10.0, next.data()[0], 1e-9);
        assertEquals(20.0, next.data()[1], 1e-9);
        assertEquals(30.0, next.data()[2], 1e-9);
        assertEquals(1.0, next.data()[3], 1e-12);
        assertEquals(2.0, next.data()[4], 1e-12);
        assertEquals(3.0, next.data()[5], 1e-12);
    }

    @Test
    void symmetricTwoBodyProducesSymmetricMotion() {
        // Same setup as the RK4 symmetry test — the high-order adaptive
        // integrator should also preserve the mirror symmetry exactly.
        double M = 1e24;
        double d = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        GlobalState state = new GlobalState(new double[]{
            -d, 0, 0, 0, 0, 0,
             d, 0, 0, 0, 0, 0,
        }, 2);

        GlobalState next = new DP853Integrator().step(state, 100.0, derivs);

        assertEquals(next.data()[0], -next.data()[6], Math.abs(next.data()[6]) * 1e-9);
        assertEquals(next.data()[3], -next.data()[9], Math.abs(next.data()[9]) * 1e-9);
        assertEquals(0.0, next.data()[1], 1e-6);
        assertEquals(0.0, next.data()[2], 1e-6);
    }

    @Test
    void doesNotMutateInputState() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});
        double[] data = {0, 0, 0, 1, 2, 3};
        GlobalState state = new GlobalState(data, 1);

        new DP853Integrator().step(state, 10.0, derivs);

        assertEquals(0.0, data[0], 1e-12);
        assertEquals(1.0, data[3], 1e-12);
    }

    /**
     * With dt of 7 days, Hipparchus's MAX_STEP=1 day cap forces the
     * integrator to take at least 6 accepted substeps before the final one,
     * so the substep handler must fire with strictly intermediate times.
     */
    @Test
    void substepHandlerReceivesIntermediateAcceptedSubsteps() {
        // Sun + Earth at perihelion-ish — enough gravity that DP853 doesn't
        // race through, but not stiff enough to time out.
        double mSun = 1.989e30;
        double mEarth = 5.972e24;
        double r = 1.496e11;
        double v = 2.978e4;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{mSun, mEarth});
        GlobalState state = new GlobalState(new double[]{
                0, 0, 0, 0, 0, 0,
                r, 0, 0, 0, v, 0,
        }, 2);

        DP853Integrator dp = new DP853Integrator();
        List<Double> substepTimes = new ArrayList<>();
        dp.setSubstepHandler((t, y) -> substepTimes.add(t));

        double dt = 86400.0 * 7;
        dp.step(state, dt, derivs);

        assertFalse(substepTimes.isEmpty(),
                "Substep handler must fire for dt > MAX_STEP");
        for (double t : substepTimes) {
            assertTrue(t > 0 && t < dt,
                    "Substep time " + t + " must lie strictly within (0, " + dt + ")");
        }
        for (int i = 1; i < substepTimes.size(); i++) {
            assertTrue(substepTimes.get(i) > substepTimes.get(i - 1),
                    "Substep times must be monotonically increasing");
        }
    }

    @Test
    void substepHandlerNotCalledWhenUnset() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1.989e30, 5.972e24});
        GlobalState state = new GlobalState(new double[]{
                0, 0, 0, 0, 0, 0,
                1.496e11, 0, 0, 0, 2.978e4, 0,
        }, 2);

        // No handler registered. Should run without invoking anything.
        new DP853Integrator().step(state, 86400.0 * 7, derivs);
        // No assertion needed — if a stray callback were firing it'd NPE
        // or surface in coverage. This test pins "absent handler = no work".
    }
}
