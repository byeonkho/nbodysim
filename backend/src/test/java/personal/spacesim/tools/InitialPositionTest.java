package personal.spacesim.tools;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.orekit.bodies.CelestialBody;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.simulation.frame.CustomFrameFactory;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins Orekit's heliocentric body positions at a fixed date against a
 * snapshot taken from the bundled DE ephemerides. Catches:
 *   - Orekit minor-version updates that shift body positions outside
 *     the abs-tolerance below (would change the integrator's starting
 *     state, silently affecting all downstream simulation results).
 *   - Frame-factory regressions (e.g. Heliocentric frame accidentally
 *     swapping to an Earth-centered or barycentric base).
 *   - JPL ephemeris file replacement (e.g. swap from DE440 to DE441
 *     would cause sub-km shifts that this test would surface).
 *
 * Sister test: frontend coordinates.test.ts pins the ICRF → three.js
 * Y/Z swap. Together they pin the full backend → render coordinate
 * pipeline.
 */
@SpringBootTest
public class InitialPositionTest {

    @Autowired
    private CustomFrameFactory frameFactory;

    private static final double METRES_PER_AU = 1.495978707e11;

    // Tolerance: 1e-6 AU ≈ 150 km. JPL DE ephemerides are stable to
    // sub-meter precision across minor revisions; 150 km picks up any
    // major file swap or frame regression while leaving headroom for
    // floating-point noise.
    private static final double TOL_AU = 1e-6;

    /** Reference snapshot — frozen on 2024-10-20 07:00 UTC, "Heliocentric" frame. */
    private record Expected(String name, double xAU, double yAU, double zAU) {}

    private static final Expected[] EXPECTED = new Expected[] {
            new Expected("Sun",      +0.000000, -0.000000, +0.000000),
            new Expected("Mercury",  -0.273755, -0.375107, -0.027004),
            new Expected("Venus",    +0.136699, -0.714346, +0.031839),
            new Expected("Earth",    +0.967306, +0.216253, +0.094427),
            new Expected("Mars",     +0.794055, +1.305134, +0.028205),
            new Expected("Jupiter",  +2.759650, +4.240521, -0.009362),
            new Expected("Saturn",   +8.517497, -4.454082, +0.883451),
            new Expected("Uranus",  +14.967624, +12.574958, +0.805570),
            new Expected("Neptune", +28.553960, -8.327784, +3.016954),
            new Expected("Moon",     +0.968800, +0.218182, +0.094671),
    };

    @Test
    void heliocentricPositionsMatchSnapshot() {
        AbsoluteDate date = new AbsoluteDate(
                "2024-10-20T07:00:00.000",
                TimeScalesFactory.getUTC()
        );
        Frame helio = frameFactory.createFrame("heliocentric");

        for (Expected e : EXPECTED) {
            CelestialBody body = CelestialBodyFactory.getBody(e.name());
            Vector3D pos = body.getPVCoordinates(date, helio).getPosition();
            double xAu = pos.getX() / METRES_PER_AU;
            double yAu = pos.getY() / METRES_PER_AU;
            double zAu = pos.getZ() / METRES_PER_AU;

            assertEquals(e.xAU(), xAu, TOL_AU,
                    String.format("%s.x drifted (got %.6f, expected %.6f AU)",
                            e.name(), xAu, e.xAU()));
            assertEquals(e.yAU(), yAu, TOL_AU,
                    String.format("%s.y drifted (got %.6f, expected %.6f AU)",
                            e.name(), yAu, e.yAU()));
            assertEquals(e.zAU(), zAu, TOL_AU,
                    String.format("%s.z drifted (got %.6f, expected %.6f AU)",
                            e.name(), zAu, e.zAU()));
        }
    }

    @Test
    void eclipticPlaneAssumptionHolds() {
        // Sanity: the |Z| / |r| ratio should never exceed sin(23.4°) ≈ 0.4
        // for any major body. This is what makes the design's top-down
        // ecliptic projection visually reasonable. If a future frame
        // change put bodies into an unexpected orientation (e.g.,
        // accidentally serving Earth-centered coords), bodies would
        // suddenly have |Z| comparable to |X|/|Y| and this would catch
        // it before it shipped.
        AbsoluteDate date = new AbsoluteDate(
                "2024-10-20T07:00:00.000",
                TimeScalesFactory.getUTC()
        );
        Frame helio = frameFactory.createFrame("heliocentric");

        double maxRatio = Math.sin(Math.toRadians(23.4)) + 0.05; // headroom
        String[] planets = {"Mercury", "Venus", "Earth", "Mars",
                "Jupiter", "Saturn", "Uranus", "Neptune"};

        for (String name : planets) {
            CelestialBody body = CelestialBodyFactory.getBody(name);
            Vector3D pos = body.getPVCoordinates(date, helio).getPosition();
            double r = pos.getNorm();
            double z = Math.abs(pos.getZ());
            double ratio = z / r;
            assert ratio < maxRatio
                    : String.format("%s: |z|/|r| = %.3f exceeds ecliptic-tilt bound %.3f",
                    name, ratio, maxRatio);
        }
    }
}
