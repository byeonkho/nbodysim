package personal.spacesim.simulation.body;

import org.hipparchus.geometry.euclidean.threed.Vector3D;

public record CelestialBodySnapshot(
        String name,
        Vector3D position,
        Vector3D velocity
) {}
