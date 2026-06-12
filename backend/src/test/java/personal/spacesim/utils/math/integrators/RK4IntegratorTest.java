package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RK4IntegratorTest {

    private static final double G = PhysicsConstants.GRAVITATIONAL_CONSTANT;

    @Test
    void zeroForceSingleBodyAdvancesExactlyByDtTimesVelocity() {
        // Single body with no other masses → zero acceleration. With constant
        // velocity, the derivative function returns (v, 0) regardless of
        // intermediate state, so RK4 reduces to y_n + dt * (v, 0) — exact.
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * 1e24});
        GlobalState state = new GlobalState(new double[]{0, 0, 0, 1, 2, 3}, 1);

        GlobalState next = new RK4Integrator().step(state, 10.0, derivs);

        // Position advances by 10 * (1, 2, 3)
        assertEquals(10.0, next.data()[0], 1e-12);
        assertEquals(20.0, next.data()[1], 1e-12);
        assertEquals(30.0, next.data()[2], 1e-12);
        // Velocity unchanged (no acceleration)
        assertEquals(1.0, next.data()[3], 1e-12);
        assertEquals(2.0, next.data()[4], 1e-12);
        assertEquals(3.0, next.data()[5], 1e-12);
    }

    @Test
    void symmetricTwoBodyProducesSymmetricMotion() {
        // Two equal masses on the x-axis at +/- d, zero initial velocity.
        // After one step, they should be mirror images about the origin —
        // body 0's resulting (x, vx) equals body 1's negated (x, vx).
        double M = 1e24;
        double d = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * M, G * M});

        GlobalState state = new GlobalState(new double[]{
            -d, 0, 0, 0, 0, 0,  // body 0
             d, 0, 0, 0, 0, 0,  // body 1
        }, 2);

        GlobalState next = new RK4Integrator().step(state, 100.0, derivs);

        // body 0 x == -body 1 x (mirror)
        assertEquals(next.data()[0], -next.data()[6], Math.abs(next.data()[6]) * 1e-10);
        // body 0 vx == -body 1 vx
        assertEquals(next.data()[3], -next.data()[9], Math.abs(next.data()[9]) * 1e-10);
        // y/z components stay at zero (no force off-axis)
        assertEquals(0.0, next.data()[1], 1e-6);
        assertEquals(0.0, next.data()[2], 1e-6);
        assertEquals(0.0, next.data()[7], 1e-6);
        assertEquals(0.0, next.data()[8], 1e-6);
        assertEquals(0.0, next.data()[4], 1e-12);
        assertEquals(0.0, next.data()[10], 1e-12);
    }

    @Test
    void doesNotMutateInputState() {
        // RK4 returns a new state; the caller's input array must be untouched.
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{G * 1e24});
        double[] data = {0, 0, 0, 1, 2, 3};
        GlobalState state = new GlobalState(data, 1);

        new RK4Integrator().step(state, 10.0, derivs);

        assertEquals(0.0, data[0], 1e-12);
        assertEquals(1.0, data[3], 1e-12);
    }
}
