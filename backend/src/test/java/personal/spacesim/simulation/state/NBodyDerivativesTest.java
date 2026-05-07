package personal.spacesim.simulation.state;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NBodyDerivativesTest {

    @Test
    void positionDerivativeEqualsVelocity() {
        // Single body with known velocity. The position-derivative slot of
        // dy/dt should equal that velocity (verbatim copy).
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});

        // position (10, 20, 30), velocity (1, 2, 3)
        GlobalState state = new GlobalState(new double[]{10, 20, 30, 1, 2, 3}, 1);
        GlobalState dy = derivs.derivatives(state);

        assertEquals(1.0, dy.data()[0], 1e-12);
        assertEquals(2.0, dy.data()[1], 1e-12);
        assertEquals(3.0, dy.data()[2], 1e-12);

        // With no other bodies, velocity-derivative (acceleration) is zero.
        assertEquals(0.0, dy.data()[3], 1e-12);
        assertEquals(0.0, dy.data()[4], 1e-12);
        assertEquals(0.0, dy.data()[5], 1e-12);
    }

    @Test
    void twoBodySymmetricAttraction() {
        // Two equal masses M, positions (-d, 0, 0) and (d, 0, 0), zero velocity.
        // Body 0 should accelerate in +x at G*M / (2d)^2 = G*M / (4 d^2).
        // Body 1 should accelerate in -x at the same magnitude.
        double M = 1e24;
        double d = 1e10;
        double expectedAccelMag =
            PhysicsConstants.GRAVITATIONAL_CONSTANT * M / (4.0 * d * d);

        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        double[] data = {
            -d, 0, 0, 0, 0, 0,  // body 0
             d, 0, 0, 0, 0, 0,  // body 1
        };
        GlobalState state = new GlobalState(data, 2);
        GlobalState dy = derivs.derivatives(state);

        // Body 0 acceleration: pulled +x toward body 1.
        assertEquals(expectedAccelMag, dy.data()[3], expectedAccelMag * 1e-10);
        assertEquals(0.0, dy.data()[4], 1e-12);
        assertEquals(0.0, dy.data()[5], 1e-12);

        // Body 1 acceleration: pulled -x toward body 0.
        assertEquals(-expectedAccelMag, dy.data()[9], expectedAccelMag * 1e-10);
        assertEquals(0.0, dy.data()[10], 1e-12);
        assertEquals(0.0, dy.data()[11], 1e-12);
    }

    @Test
    void selfDoesNotAttractSelf() {
        // Lone body — its acceleration should be zero (no other body to pull it).
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});

        GlobalState state = new GlobalState(new double[]{5, 5, 5, 0, 0, 0}, 1);
        GlobalState dy = derivs.derivatives(state);

        assertEquals(0.0, dy.data()[3], 1e-12);
        assertEquals(0.0, dy.data()[4], 1e-12);
        assertEquals(0.0, dy.data()[5], 1e-12);
    }

    @Test
    void rejectsMismatchedBodyCount() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24});
        // state has 2 bodies but derivs is configured for 1
        GlobalState state = new GlobalState(new double[12], 2);

        assertThrows(IllegalArgumentException.class, () -> derivs.derivatives(state));
    }
}
