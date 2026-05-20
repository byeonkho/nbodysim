package personal.spacesim.simulation.state;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    @Test
    void testParticleDoesNotPerturbMassive() {
        // Sun-like body at origin, test particle at (1e11, 0, 0). With
        // massiveCount=1 the test particle's mass should not appear in the
        // Sun's acceleration sum.
        double sunMass = 1.989e30;        // kg
        double tpMass  = 1.0e15;          // tiny but non-zero
        double[] masses = { sunMass, tpMass };

        NBodyDerivatives tp = new NBodyDerivatives(masses, 1);

        double[] state = new double[12];
        state[6] = 1e11;  // test particle at (1e11, 0, 0), at rest
        double[] out = new double[12];
        tp.derivativesInto(out, state);

        // Sun (i=0, massive) must NOT feel the test particle. Test particles
        // exert no gravitational influence — that's what makes them "test"
        // particles. By Newton's 3rd law if Sun felt TP force then TP would
        // feel reciprocal force on Sun, breaking momentum conservation.
        // The dispatch enforces this by bounding all force sums to the
        // massive prefix, regardless of whether the summing body is massive
        // or test.
        assertEquals(0.0, out[3], 1e-25, "Sun ax under TP must be 0");
        assertEquals(0.0, out[4], 1e-25, "Sun ay under TP must be 0");
        assertEquals(0.0, out[5], 1e-25, "Sun az under TP must be 0");
    }

    @Test
    void testParticleFeelsMassive() {
        // Sun at origin, test particle at (1e11, 0, 0). Test particle must
        // accelerate toward the Sun (-x direction).
        double sunMass = 1.989e30;
        double[] masses = { sunMass, 1.0e15 };
        NBodyDerivatives tp = new NBodyDerivatives(masses, 1);

        double[] state = new double[12];
        state[6] = 1e11;
        double[] out = new double[12];
        tp.derivativesInto(out, state);

        // Test particle (i=1) acceleration in -x (toward Sun).
        assertTrue(out[9] < 0, "Test particle ax must be negative (toward Sun)");

        // Magnitude check: a = G * M_sun / r^2 ~ 6.67e-11 * 1.989e30 / 1e22
        //                    ~ 1.33e-3 m/s^2
        double expected = PhysicsConstants.GRAVITATIONAL_CONSTANT * sunMass / 1e22;
        assertEquals(-expected, out[9], expected * 1e-10);
    }

    @Test
    void backwardsCompatConstructorAllMassive() {
        // Two equal massive bodies, no massiveCount specified. Both bodies
        // should feel each other (same as the original twoBodySymmetricAttraction
        // test).
        double M = 1e24;
        double d = 1e10;
        double expectedAccelMag =
            PhysicsConstants.GRAVITATIONAL_CONSTANT * M / (4.0 * d * d);

        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        double[] data = {
            -d, 0, 0, 0, 0, 0,
             d, 0, 0, 0, 0, 0,
        };
        double[] out = new double[12];
        derivs.derivativesInto(out, data);

        assertEquals( expectedAccelMag, out[3], expectedAccelMag * 1e-10);
        assertEquals(-expectedAccelMag, out[9], expectedAccelMag * 1e-10);
    }

    @Test
    void twoMassiveTwoTestParticles_costModel() {
        // Two massive bodies + two HEAVY test particles placed 1m apart.
        // If test particles influenced each other, the 1m-separation 1/r^2
        // pull between them would dominate. With the test-particle dispatch
        // their mutual force is excluded; only the gradient from massive
        // bodies remains, which over 1m is tiny.
        double M = 1e30;       // sun-like massive
        double mTp = 1e20;     // very heavy "test particles" — would dominate
                               // if they could interact
        double[] masses = { M, M, mTp, mTp };
        NBodyDerivatives tp = new NBodyDerivatives(masses, 2);

        double[] state = new double[24];
        state[0] = -1e11;                // body 0 massive
        state[6] =  1e11;                // body 1 massive
        state[12] = 0; state[13] = 1e9;  // body 2 test
        state[18] = 1; state[19] = 1e9;  // body 3 test (1m from body 2)

        double[] out = new double[24];
        tp.derivativesInto(out, state);

        // Acceleration ax3 - ax2 measures any "felt difference" between the
        // two test particles. Massive-only force gradient over 1m at scale
        // r ≈ 1e11 m is ~ 2GM/r^3 ≈ 2 * 6.67e-11 * 1e30 / 1e33 ≈ 1.3e-13
        // m/s^2. If they pulled on each other at 1m, that would be
        // G*mTp/r^2 = 6.67e-11 * 1e20 / 1 = 6.67e9 m/s^2 — 22 orders of
        // magnitude larger. So a |diff| << 1 m/s^2 confirms no T-T coupling.
        double diff = Math.abs(out[15] - out[21]);
        assertTrue(diff < 1.0,
            "Test particles 1m apart must not feel each other; got diff=" + diff);
        // And the per-particle acceleration is the massive-gradient scale.
        assertTrue(Math.abs(out[15]) < 1.0e-6,
            "TP ax under symmetric massive bodies must be near zero; got " + out[15]);
    }

    @Test
    void massiveCountValidation() {
        double[] masses = { 1e24, 1e24 };
        assertThrows(IllegalArgumentException.class,
            () -> new NBodyDerivatives(masses, -1));
        assertThrows(IllegalArgumentException.class,
            () -> new NBodyDerivatives(masses, 3));
    }

    @Test
    void totalEnergyRestrictedToMassiveSubsystem() {
        // Two massive bodies form a bound pair. Add a test particle at the
        // same location as one of them. If energy summed over all bodies,
        // adding/removing the test particle would change the result. With
        // the massive-only restriction, the test particle contributes
        // nothing.
        double M = 1e30;
        double d = 1e10;

        // Configuration: massive at (-d, 0, 0) at rest; massive at (d, 0, 0) at rest.
        double[] state2 = {
            -d, 0, 0, 0, 0, 0,
             d, 0, 0, 0, 0, 0,
        };
        NBodyDerivatives derivs2 = new NBodyDerivatives(new double[]{M, M}, 2);
        double e2 = derivs2.totalEnergy(state2);

        // Same configuration + test particle at random position with non-zero velocity.
        double[] state3 = new double[18];
        System.arraycopy(state2, 0, state3, 0, 12);
        state3[12] = 5e10; state3[13] = 5e10;
        state3[15] = 1e4;  // velocity
        NBodyDerivatives derivs3 = new NBodyDerivatives(new double[]{M, M, 1.0}, 2);
        double e3 = derivs3.totalEnergy(state3);

        // The test particle's contribution must be zero — energy unchanged.
        assertEquals(e2, e3, Math.abs(e2) * 1e-10);
    }
}
