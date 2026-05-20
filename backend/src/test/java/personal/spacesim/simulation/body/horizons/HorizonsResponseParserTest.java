package personal.spacesim.simulation.body.horizons;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.nio.file.Files;

import static org.junit.jupiter.api.Assertions.*;

class HorizonsResponseParserTest {

    @Test
    void parsesErosJ2000FromCapturedResponse() throws Exception {
        String text = Files.readString(
            new ClassPathResource("horizons/eros-j2000-response.txt").getFile().toPath());

        HorizonsResponseParser.State state = HorizonsResponseParser.parseFirstRecord(text);

        // Eros at J2000 should be at ~1-2 AU from origin (heliocentric ICRF).
        // 1 AU = 1.496e11 m. Sanity-check the magnitude.
        Vector3D pos = state.position();
        double r = pos.getNorm();
        assertTrue(r > 1e11 && r < 5e11,
            "Eros heliocentric distance at J2000 implausible: " + r + " m");

        Vector3D vel = state.velocity();
        double v = vel.getNorm();
        // Eros orbital speed ~17 km/s aphelion to ~24 km/s perihelion;
        // ~26 km/s at the J2000 epoch sample we captured.
        assertTrue(v > 1e4 && v < 4e4,
            "Eros orbital speed at J2000 implausible: " + v + " m/s");
    }

    @Test
    void converts_km_to_meters() throws Exception {
        // The captured response has X = -1.790704722183158E+08 (km).
        // After parsing, position.x must equal that times 1000 (m).
        String text = Files.readString(
            new ClassPathResource("horizons/eros-j2000-response.txt").getFile().toPath());
        HorizonsResponseParser.State state = HorizonsResponseParser.parseFirstRecord(text);
        // Allow tiny float drift.
        assertEquals(-1.790704722183158E+11, state.position().getX(), 1.0);
        assertEquals(-6.218728571805532E+10, state.position().getY(), 1.0);
        assertEquals(-6.765283097103940E+10, state.position().getZ(), 1.0);
        assertEquals( 6.224412243197595E+03, state.velocity().getX(), 1.0e-3);
        assertEquals(-2.299889108496817E+04, state.velocity().getY(), 1.0e-3);
        assertEquals(-1.194703052978219E+04, state.velocity().getZ(), 1.0e-3);
    }

    @Test
    void throwsOnNoSoeBlock() {
        String text = "Some garbage that has no SOE/EOE markers";
        assertThrows(IllegalArgumentException.class,
            () -> HorizonsResponseParser.parseFirstRecord(text));
    }

    @Test
    void throwsOnMissingVectorLines() {
        String text = "$$SOE\nblah blah no vectors here\n$$EOE";
        assertThrows(IllegalArgumentException.class,
            () -> HorizonsResponseParser.parseFirstRecord(text));
    }
}
