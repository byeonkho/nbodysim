package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
}
