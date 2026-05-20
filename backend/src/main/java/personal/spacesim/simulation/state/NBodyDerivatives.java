package personal.spacesim.simulation.state;

import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.util.List;

/**
 * Computes the time-derivative {@code dy/dt} of an N-body system's state
 * under mutual gravitational attraction, with optional test-particle
 * dispatch.
 *
 * <p>Given a state {@code y = [r_0, v_0, r_1, v_1, ...]}, returns the
 * derivative where:
 * <ul>
 *   <li>position derivative for body i is its velocity:
 *       {@code dr_i/dt = v_i}</li>
 *   <li>velocity derivative for body i is the gravitational acceleration
 *       summed over each massive body j (excluding self):
 *       {@code dv_i/dt = sum_{j massive, j != i} G * m_j * (r_j - r_i) / |r_j - r_i|^3}</li>
 * </ul>
 *
 * <p><b>Test-particle dispatch.</b> State buffer layout is
 * {@code [massive | test]}: the first {@code massiveCount} bodies are
 * massive (mutually gravitating); the remaining bodies are test particles
 * (feel gravity from the massive prefix but exert none — their mass
 * doesn't enter any force sum). This preserves Newton's 3rd law on the
 * massive subsystem while letting the catalog grow with small bodies at
 * cost {@code M*(M-1) + T*M} per step instead of {@code (M+T)*(M+T-1)}.
 *
 * <p>Masses are captured at construction; the bodies in the system are
 * assumed not to gain or lose mass during simulation.
 */
public final class NBodyDerivatives {

    /** Pre-computed G * m_i for each body, indexed by body position. */
    private final double[] gm;

    /**
     * Count of leading massive bodies in the state buffer. Force sums
     * over the {@code [0, massiveCount)} prefix only. Equals
     * {@code gm.length} when no test particles are present.
     */
    private final int massiveCount;

    /**
     * Build a derivatives function for the given masses and massive-body
     * count. The first {@code massiveCount} entries are massive
     * (mutually gravitating); the rest are test particles. Order of the
     * array must match the body ordering used in the {@link GlobalState}
     * this is applied to.
     */
    public NBodyDerivatives(double[] masses, int massiveCount) {
        if (massiveCount < 0 || massiveCount > masses.length) {
            throw new IllegalArgumentException(
                "massiveCount " + massiveCount + " out of [0, " + masses.length + "]");
        }
        this.gm = new double[masses.length];
        for (int i = 0; i < masses.length; i++) {
            this.gm[i] = PhysicsConstants.GRAVITATIONAL_CONSTANT * masses[i];
        }
        this.massiveCount = massiveCount;
    }

    /**
     * Backwards-compatible constructor: all bodies treated as massive
     * (equivalent to {@code massiveCount = masses.length}).
     */
    public NBodyDerivatives(double[] masses) {
        this(masses, masses.length);
    }

    /**
     * Convenience constructor: extract masses from a list of celestial bodies.
     * All bodies treated as massive.
     */
    public static NBodyDerivatives forBodies(List<CelestialBodyWrapper> bodies) {
        return forBodies(bodies, bodies.size());
    }

    /**
     * Convenience constructor with explicit massive-body count.
     */
    public static NBodyDerivatives forBodies(
            List<CelestialBodyWrapper> bodies, int massiveCount
    ) {
        double[] masses = new double[bodies.size()];
        for (int i = 0; i < bodies.size(); i++) {
            masses[i] = bodies.get(i).getMass();
        }
        return new NBodyDerivatives(masses, massiveCount);
    }

    /**
     * Mutating-output variant. Writes {@code dy/dt} into {@code out} given the
     * raw flat state array. Caller owns both arrays; this method only reads
     * {@code state} and only writes {@code out}.
     *
     * <p>Hot path: called inside every integrator step (1× for Euler, 4× for
     * RK4, ~13× per step for DP853 via Hipparchus substeps). Avoiding the
     * per-call {@code new double[6N]} + {@code new GlobalState} allocations
     * is the primary goal of this API.
     *
     * <p>Inner loop is bounded by {@code massiveCount} for every body i,
     * regardless of i's class — see class javadoc for why this preserves
     * test-particle physics.
     */
    public void derivativesInto(double[] out, double[] state) {
        int n = state.length / GlobalState.COORDS_PER_BODY;
        if (n != gm.length) {
            throw new IllegalArgumentException(
                "state bodyCount " + n + " does not match this derivatives' bodyCount " + gm.length);
        }
        if (out.length != state.length) {
            throw new IllegalArgumentException(
                "out length " + out.length + " does not match state length " + state.length);
        }

        // Hoisted out of the inner loop — single read into a local primitive,
        // no per-iteration bound switch.
        final int sumBound = massiveCount;

        for (int i = 0; i < n; i++) {
            int baseI = i * GlobalState.COORDS_PER_BODY;
            double xi = state[baseI];
            double yi = state[baseI + 1];
            double zi = state[baseI + 2];
            double vxi = state[baseI + 3];
            double vyi = state[baseI + 4];
            double vzi = state[baseI + 5];

            // dr_i / dt = v_i
            out[baseI]     = vxi;
            out[baseI + 1] = vyi;
            out[baseI + 2] = vzi;

            // dv_i / dt = sum over massive j != i of gm[j] * (r_j - r_i) / |r_j - r_i|^3
            double ax = 0, ay = 0, az = 0;
            for (int j = 0; j < sumBound; j++) {
                if (i == j) continue;
                int baseJ = j * GlobalState.COORDS_PER_BODY;
                double dx = state[baseJ]     - xi;
                double dy = state[baseJ + 1] - yi;
                double dz = state[baseJ + 2] - zi;
                double r2 = dx * dx + dy * dy + dz * dz;
                double invR3 = 1.0 / (r2 * Math.sqrt(r2));
                double factor = gm[j] * invR3;
                ax += factor * dx;
                ay += factor * dy;
                az += factor * dz;
            }
            out[baseI + 3] = ax;
            out[baseI + 4] = ay;
            out[baseI + 5] = az;
        }
    }

    /**
     * Total mechanical energy {@code E = T + U} of the massive subsystem
     * in the given flat state vector. Test particles contribute nothing —
     * their kinetic and potential terms are physically negligible and
     * would couple the {@code ΔE/E_0} integrator-quality readout to noise.
     *
     * <p>Returned in joules (SI). Sign convention: kinetic positive,
     * potential negative for bound systems; the sum is negative for any
     * gravitationally bound configuration.
     *
     * <p>Hot path: called once per emitted snapshot (~5000 times per
     * DP853 chunk). Allocation-free; single indexed pair loop over the
     * massive prefix. {@code 1/G} is factored out so we reuse the
     * existing {@code gm[]} array rather than carrying a parallel mass
     * array.
     *
     * <p>Math:
     * <pre>
     * T = 0.5 / G · Σ_{i massive} gm[i] · |v_i|²
     * U = -1.0 / G · Σ_{i&lt;j, both massive} gm[i] · gm[j] / r_ij
     * </pre>
     */
    public double totalEnergy(double[] state) {
        int n = state.length / GlobalState.COORDS_PER_BODY;
        if (n != gm.length) {
            throw new IllegalArgumentException(
                "state bodyCount " + n + " does not match this derivatives' bodyCount " + gm.length);
        }

        double kineticSum = 0.0;
        double potentialSum = 0.0;
        for (int i = 0; i < massiveCount; i++) {
            int baseI = i * GlobalState.COORDS_PER_BODY;
            double xi = state[baseI];
            double yi = state[baseI + 1];
            double zi = state[baseI + 2];
            double vxi = state[baseI + 3];
            double vyi = state[baseI + 4];
            double vzi = state[baseI + 5];

            kineticSum += gm[i] * (vxi * vxi + vyi * vyi + vzi * vzi);

            for (int j = i + 1; j < massiveCount; j++) {
                int baseJ = j * GlobalState.COORDS_PER_BODY;
                double dx = state[baseJ]     - xi;
                double dy = state[baseJ + 1] - yi;
                double dz = state[baseJ + 2] - zi;
                double r = Math.sqrt(dx * dx + dy * dy + dz * dz);
                potentialSum += gm[i] * gm[j] / r;
            }
        }

        double invG = 1.0 / PhysicsConstants.GRAVITATIONAL_CONSTANT;
        return invG * (0.5 * kineticSum - potentialSum);
    }

    /**
     * Allocating wrapper around {@link #derivativesInto}. Convenient for tests
     * and one-shot calls; not for hot loops.
     */
    public GlobalState derivatives(GlobalState state) {
        double[] result = new double[state.data().length];
        derivativesInto(result, state.data());
        return new GlobalState(result, state.bodyCount());
    }
}
