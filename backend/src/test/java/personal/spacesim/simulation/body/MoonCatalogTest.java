package personal.spacesim.simulation.body;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MoonCatalogTest {

    @Test
    void containsAllTwentyOneMoons() {
        String[] expected = {
            "PHOBOS", "DEIMOS",
            "IO", "EUROPA", "GANYMEDE", "CALLISTO",
            "MIMAS", "ENCELADUS", "TETHYS", "DIONE", "RHEA", "TITAN", "IAPETUS",
            "ARIEL", "UMBRIEL", "TITANIA", "OBERON", "MIRANDA",
            "TRITON", "NEREID",
            "CHARON",
        };
        for (String n : expected) {
            assertTrue(MoonCatalog.isMoon(n), n + " missing");
            assertNotNull(MoonCatalog.get(n), n + " entry missing");
        }
    }

    @Test
    void massiveMoonsAreClassifiedCorrectly() {
        String[] massive = {"IO", "EUROPA", "GANYMEDE", "CALLISTO", "TITAN", "TRITON", "CHARON"};
        for (String n : massive) {
            assertFalse(MoonCatalog.get(n).isTestParticle(), n + " must be massive");
        }
    }

    @Test
    void testParticleMoonsAreClassifiedCorrectly() {
        String[] test = {
            "PHOBOS", "DEIMOS",
            "MIMAS", "ENCELADUS", "TETHYS", "DIONE", "RHEA", "IAPETUS",
            "ARIEL", "UMBRIEL", "TITANIA", "OBERON", "MIRANDA",
            "NEREID",
        };
        for (String n : test) {
            assertTrue(MoonCatalog.get(n).isTestParticle(), n + " must be test particle");
        }
    }

    @Test
    void parentNamesMatchPhysicalReality() {
        assertEquals("MARS",    MoonCatalog.get("PHOBOS").parent());
        assertEquals("MARS",    MoonCatalog.get("DEIMOS").parent());
        assertEquals("JUPITER", MoonCatalog.get("IO").parent());
        assertEquals("JUPITER", MoonCatalog.get("EUROPA").parent());
        assertEquals("SATURN",  MoonCatalog.get("TITAN").parent());
        assertEquals("SATURN",  MoonCatalog.get("IAPETUS").parent());
        assertEquals("URANUS",  MoonCatalog.get("MIRANDA").parent());
        assertEquals("URANUS",  MoonCatalog.get("OBERON").parent());
        assertEquals("NEPTUNE", MoonCatalog.get("TRITON").parent());
        assertEquals("PLUTO",   MoonCatalog.get("CHARON").parent());
    }

    @Test
    void naifIdsMatchJplCanonical() {
        assertEquals("401", MoonCatalog.get("PHOBOS").naifId());
        assertEquals("501", MoonCatalog.get("IO").naifId());
        assertEquals("606", MoonCatalog.get("TITAN").naifId());
        assertEquals("801", MoonCatalog.get("TRITON").naifId());
        assertEquals("901", MoonCatalog.get("CHARON").naifId());
    }

    @Test
    void lookupIsCaseInsensitive() {
        assertNotNull(MoonCatalog.get("io"));
        assertNotNull(MoonCatalog.get("Titan"));
        assertTrue(MoonCatalog.isMoon("triton"));
    }

    @Test
    void unknownReturnsNull() {
        assertFalse(MoonCatalog.isMoon("XYZZY"));
        assertNull(MoonCatalog.get("XYZZY"));
    }

    @Test
    void earthsMoonIsNotInMoonCatalog() {
        // Earth's Moon is Orekit-sourced via DE-440 (not via Horizons), and
        // stays on its existing render path. MoonCatalog only contains the
        // 21 moons that need Horizons fetching.
        assertFalse(MoonCatalog.isMoon("MOON"));
    }
}
