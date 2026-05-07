package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

import static org.junit.jupiter.api.Assertions.assertEquals;

class EulerIntegratorTest {

    @Test
    void zeroForceSingleBodyAdvancesExactlyByDtTimesVelocity() {
        // Single body, no others. f(y) returns (v, 0); Euler yields
        // y + dt * (v, 0) — exact for this trivial case.
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});
        GlobalState state = new GlobalState(new double[]{0, 0, 0, 1, 2, 3}, 1);

        GlobalState next = new EulerIntegrator().step(state, 10.0, derivs);

        assertEquals(10.0, next.data()[0], 1e-12);
        assertEquals(20.0, next.data()[1], 1e-12);
        assertEquals(30.0, next.data()[2], 1e-12);
        assertEquals(1.0, next.data()[3], 1e-12);
        assertEquals(2.0, next.data()[4], 1e-12);
        assertEquals(3.0, next.data()[5], 1e-12);
    }

    @Test
    void symmetricTwoBodyProducesSymmetricMotion() {
        // Two equal masses on the x-axis; first-order Euler should still
        // preserve the mirror symmetry — symmetry is a property of the
        // derivative function, not the integrator's accuracy.
        double M = 1e24;
        double d = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        GlobalState state = new GlobalState(new double[]{
            -d, 0, 0, 0, 0, 0,
             d, 0, 0, 0, 0, 0,
        }, 2);

        GlobalState next = new EulerIntegrator().step(state, 100.0, derivs);

        assertEquals(next.data()[0], -next.data()[6], Math.abs(next.data()[6]) * 1e-10);
        assertEquals(next.data()[3], -next.data()[9], Math.abs(next.data()[9]) * 1e-10);
        assertEquals(0.0, next.data()[1], 1e-6);
        assertEquals(0.0, next.data()[2], 1e-6);
        assertEquals(0.0, next.data()[7], 1e-6);
        assertEquals(0.0, next.data()[8], 1e-6);
    }

    @Test
    void doesNotMutateInputState() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});
        double[] data = {0, 0, 0, 1, 2, 3};
        GlobalState state = new GlobalState(data, 1);

        new EulerIntegrator().step(state, 10.0, derivs);

        assertEquals(0.0, data[0], 1e-12);
        assertEquals(1.0, data[3], 1e-12);
    }
}
