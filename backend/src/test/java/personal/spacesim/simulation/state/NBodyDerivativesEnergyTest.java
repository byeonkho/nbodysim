package personal.spacesim.simulation.state;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NBodyDerivativesEnergyTest {

    @Test
    void loneBodyHasOnlyKineticEnergy() {
        // One body, mass M, velocity (vx, 0, 0). T = 0.5·M·vx². U = 0
        // (no pairs). E = T.
        double M = 1e24;
        double vx = 1e3;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M});

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
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

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
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

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
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24, 1e24});
        // state has 1 body but derivs is configured for 2
        double[] tooShort = {0, 0, 0, 0, 0, 0};
        assertThrows(IllegalArgumentException.class, () -> derivs.totalEnergy(tooShort));
    }
}
