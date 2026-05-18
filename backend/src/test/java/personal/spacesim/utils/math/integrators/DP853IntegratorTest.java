package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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
     * Substep callbacks fire for every accepted substep — including the
     * final one ending at {@code dt}. Intervals are contiguous and span
     * the full {@code [0, dt]} range.
     *
     * <p>Previously this test asserted the final-at-dt substep was
     * suppressed (the old "avoid duplicate boundary emission" model);
     * the Simulation now drives emission at exact target times via the
     * evaluator and the suppression is unnecessary.
     */
    @Test
    void substepHandlerReceivesContiguousIntervalsCoveringFullStep() {
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
        List<double[]> intervals = new ArrayList<>();
        dp.setSubstepHandler((prev, curr, eval) -> intervals.add(new double[]{prev, curr}));

        double dt = 86400.0 * 7;
        dp.step(state, dt, derivs);

        assertFalse(intervals.isEmpty(),
                "Substep handler must fire for dt > MAX_STEP");
        assertEquals(0.0, intervals.get(0)[0], 1e-9,
                "First substep must start at t=0");
        assertEquals(dt, intervals.get(intervals.size() - 1)[1], 1e-9,
                "Last substep must end at t=dt (no suppression)");
        for (int i = 1; i < intervals.size(); i++) {
            assertEquals(intervals.get(i - 1)[1], intervals.get(i)[0], 1e-9,
                    "Substep intervals must be contiguous: prev.curr == next.prev");
        }
    }

    @Test
    void substepHandlerEvaluatorReturnsStateWithinInterval() {
        // The evaluator must be usable at any time within the substep's
        // [prev, curr] window — that's how Simulation emits at exact
        // scheduled target times.
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
        boolean[] sampled = {false};
        dp.setSubstepHandler((prev, curr, eval) -> {
            if (sampled[0]) return;
            // Mid-interval sample. Earth y-coordinate should evolve
            // measurably between t=prev and t=mid.
            double[] start = eval.stateAt(prev).clone();
            double[] mid = eval.stateAt((prev + curr) / 2.0).clone();
            assertNotEquals(start[7], mid[7],
                    "Earth's y-coordinate should evolve between prev and mid");
            sampled[0] = true;
        });

        dp.step(state, 86400.0 * 7, derivs);
        assertTrue(sampled[0], "Handler did not fire — sampling never validated");
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
