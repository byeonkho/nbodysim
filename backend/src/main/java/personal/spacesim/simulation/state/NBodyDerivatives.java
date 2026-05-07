package personal.spacesim.simulation.state;

import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.util.List;

/**
 * Computes the time-derivative {@code dy/dt} of an N-body system's state
 * under mutual gravitational attraction.
 *
 * <p>Given a state {@code y = [r_0, v_0, r_1, v_1, ...]}, returns the
 * derivative where:
 * <ul>
 *   <li>position derivative for body i is its velocity:
 *       {@code dr_i/dt = v_i}</li>
 *   <li>velocity derivative for body i is the gravitational acceleration
 *       summed over all other bodies:
 *       {@code dv_i/dt = sum_{j != i} G * m_j * (r_j - r_i) / |r_j - r_i|^3}</li>
 * </ul>
 *
 * <p>Masses are captured at construction; the bodies in the system are
 * assumed not to gain or lose mass during simulation.
 */
public final class NBodyDerivatives {

    /** Pre-computed G * m_i for each body, indexed by body position. */
    private final double[] gm;

    /**
     * Build a derivatives function for the given masses. Order of the array
     * must match the body ordering used in the {@link GlobalState} this is
     * applied to.
     */
    public NBodyDerivatives(double[] masses) {
        this.gm = new double[masses.length];
        for (int i = 0; i < masses.length; i++) {
            this.gm[i] = PhysicsConstants.GRAVITATIONAL_CONSTANT * masses[i];
        }
    }

    /**
     * Convenience constructor: extract masses from a list of celestial bodies.
     */
    public static NBodyDerivatives forBodies(List<CelestialBodyWrapper> bodies) {
        double[] masses = new double[bodies.size()];
        for (int i = 0; i < bodies.size(); i++) {
            masses[i] = bodies.get(i).getMass();
        }
        return new NBodyDerivatives(masses);
    }

    /**
     * Return the time-derivative of {@code state}. The returned state has the
     * same shape; its "position" slots hold velocities (the derivative of
     * position) and its "velocity" slots hold accelerations (the derivative
     * of velocity).
     */
    public GlobalState derivatives(GlobalState state) {
        int n = state.bodyCount();
        if (n != gm.length) {
            throw new IllegalArgumentException(
                "state bodyCount " + n + " does not match this derivatives' bodyCount " + gm.length);
        }

        double[] data = state.data();
        double[] result = new double[GlobalState.COORDS_PER_BODY * n];

        for (int i = 0; i < n; i++) {
            int baseI = i * GlobalState.COORDS_PER_BODY;
            double xi = data[baseI];
            double yi = data[baseI + 1];
            double zi = data[baseI + 2];
            double vxi = data[baseI + 3];
            double vyi = data[baseI + 4];
            double vzi = data[baseI + 5];

            // dr_i / dt = v_i
            result[baseI]     = vxi;
            result[baseI + 1] = vyi;
            result[baseI + 2] = vzi;

            // dv_i / dt = sum over j != i of gm[j] * (r_j - r_i) / |r_j - r_i|^3
            double ax = 0, ay = 0, az = 0;
            for (int j = 0; j < n; j++) {
                if (i == j) continue;
                int baseJ = j * GlobalState.COORDS_PER_BODY;
                double dx = data[baseJ]     - xi;
                double dy = data[baseJ + 1] - yi;
                double dz = data[baseJ + 2] - zi;
                double r2 = dx * dx + dy * dy + dz * dz;
                double invR3 = 1.0 / (r2 * Math.sqrt(r2));
                double factor = gm[j] * invR3;
                ax += factor * dx;
                ay += factor * dy;
                az += factor * dz;
            }
            result[baseI + 3] = ax;
            result[baseI + 4] = ay;
            result[baseI + 5] = az;
        }

        return new GlobalState(result, n);
    }
}
