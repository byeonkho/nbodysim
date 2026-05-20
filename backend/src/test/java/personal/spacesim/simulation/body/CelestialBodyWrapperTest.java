package personal.spacesim.simulation.body;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;

import static org.junit.jupiter.api.Assertions.*;

class CelestialBodyWrapperTest {

    @Test
    void buildsErosFromExplicitState() {
        Vector3D pos = new Vector3D(2e11, 1e11, 1e10);
        Vector3D vel = new Vector3D(1e4, 1e4, 0);
        double mu = 4.463e5;
        double radius = 8_420.0;

        CelestialBodyWrapper eros = new CelestialBodyWrapper("EROS", mu, radius, pos, vel);

        assertEquals("EROS", eros.getName());
        assertEquals(mu, eros.getMu(), 0.0);
        assertEquals(radius, eros.getRadius(), 0.0);
        assertEquals(pos.getX(), eros.getPosition().getX(), 0.0);
        assertEquals(pos.getY(), eros.getPosition().getY(), 0.0);
        assertEquals(pos.getZ(), eros.getPosition().getZ(), 0.0);
        assertEquals(vel.getX(), eros.getVelocity().getX(), 0.0);
        assertEquals(vel.getY(), eros.getVelocity().getY(), 0.0);
        assertEquals(vel.getZ(), eros.getVelocity().getZ(), 0.0);
    }

    @Test
    void explicitStateConstructorComputesMassFromMu() {
        // mass should equal mu / G
        double mu = 6.67430e10;  // arbitrary
        CelestialBodyWrapper w = new CelestialBodyWrapper(
            "TEST", mu, 100.0, Vector3D.ZERO, Vector3D.ZERO);
        assertEquals(mu / PhysicsConstants.GRAVITATIONAL_CONSTANT, w.getMass(), 0.0);
    }
}
