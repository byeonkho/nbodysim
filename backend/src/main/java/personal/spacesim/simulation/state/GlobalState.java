package personal.spacesim.simulation.state;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.util.List;

/**
 * Immutable flat representation of an N-body system's state.
 *
 * <p>Encodes all bodies' (x, y, z, vx, vy, vz) into a single 6N-dimensional
 * {@code double[]}. Layout per body:
 * {@code [x_0, y_0, z_0, vx_0, vy_0, vz_0, x_1, y_1, z_1, vx_1, vy_1, vz_1, ...]}.
 *
 * <p>This shape is the state vector that integrators advance through time.
 * The flat double[] backing is required for Hipparchus's
 * {@code OrdinaryDifferentialEquation} interface; it's also convenient for
 * hand-rolled integrators since arithmetic is straightforward.
 *
 * <p>Note on the {@code data()} accessor: records expose all components, so
 * the underlying array is reachable from callers. Treat it as read-only —
 * mutating it externally violates the immutability contract.
 */
public record GlobalState(double[] data, int bodyCount) {

    public static final int COORDS_PER_BODY = 6;

    public GlobalState {
        if (data.length != COORDS_PER_BODY * bodyCount) {
            throw new IllegalArgumentException(
                "data length " + data.length + " does not match bodyCount " + bodyCount
                    + " (expected " + (COORDS_PER_BODY * bodyCount) + ")");
        }
    }

    /**
     * Build a state vector from a list of celestial bodies. The order in the
     * list determines the order of bodies in the state — keep the same list
     * for {@link #unpackInto(List)}.
     */
    public static GlobalState pack(List<CelestialBodyWrapper> bodies) {
        int n = bodies.size();
        double[] data = new double[COORDS_PER_BODY * n];
        for (int i = 0; i < n; i++) {
            CelestialBodyWrapper body = bodies.get(i);
            Vector3D pos = body.getPosition();
            Vector3D vel = body.getVelocity();
            int base = i * COORDS_PER_BODY;
            data[base]     = pos.getX();
            data[base + 1] = pos.getY();
            data[base + 2] = pos.getZ();
            data[base + 3] = vel.getX();
            data[base + 4] = vel.getY();
            data[base + 5] = vel.getZ();
        }
        return new GlobalState(data, n);
    }

    /**
     * Mutate the wrappers in-place to reflect this state's positions and
     * velocities. The list must have the same size and ordering as when packed.
     */
    public void unpackInto(List<CelestialBodyWrapper> bodies) {
        if (bodies.size() != bodyCount) {
            throw new IllegalArgumentException(
                "bodies list size " + bodies.size() + " does not match bodyCount " + bodyCount);
        }
        for (int i = 0; i < bodyCount; i++) {
            bodies.get(i).setPosition(position(i));
            bodies.get(i).setVelocity(velocity(i));
        }
    }

    public Vector3D position(int i) {
        int base = i * COORDS_PER_BODY;
        return new Vector3D(data[base], data[base + 1], data[base + 2]);
    }

    public Vector3D velocity(int i) {
        int base = i * COORDS_PER_BODY;
        return new Vector3D(data[base + 3], data[base + 4], data[base + 5]);
    }

    /**
     * Return a new state equal to {@code this + scale * other}, component-wise.
     *
     * <p>Used for RK4 substep blending: e.g. {@code state.addScaled(k1, dt / 2.0)}
     * produces the half-step prediction.
     */
    public GlobalState addScaled(GlobalState other, double scale) {
        if (other.bodyCount != bodyCount) {
            throw new IllegalArgumentException(
                "shape mismatch: bodyCount " + bodyCount + " vs " + other.bodyCount);
        }
        double[] result = new double[data.length];
        for (int i = 0; i < data.length; i++) {
            result[i] = data[i] + scale * other.data[i];
        }
        return new GlobalState(result, bodyCount);
    }
}
