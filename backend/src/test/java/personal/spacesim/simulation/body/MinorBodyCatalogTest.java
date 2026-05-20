package personal.spacesim.simulation.body;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MinorBodyCatalogTest {
    @Test
    void containsAllNineMinorBodies() {
        for (String name : new String[]{
            "PLUTO", "CERES", "VESTA", "PALLAS", "HYGIEA",
            "EROS", "APOPHIS", "BENNU", "RYUGU"
        }) {
            assertTrue(MinorBodyCatalog.isMinorBody(name), name + " missing");
            MinorBodyCatalog.Entry e = MinorBodyCatalog.get(name);
            assertNotNull(e);
            assertTrue(e.mu() > 0, name + " mu must be positive");
            assertTrue(e.radius() > 0, name + " radius must be positive");
        }
    }

    @Test
    void plutoIsOrekitSourcedOthersAreHorizons() {
        assertTrue(MinorBodyCatalog.get("PLUTO").isOrekitSourced());
        assertFalse(MinorBodyCatalog.get("CERES").isOrekitSourced());
        assertFalse(MinorBodyCatalog.get("EROS").isOrekitSourced());
    }

    @Test
    void testParticleSplit() {
        // Dwarf planets / large asteroids are massive (mutually gravitating).
        assertFalse(MinorBodyCatalog.get("PLUTO").isTestParticle());
        assertFalse(MinorBodyCatalog.get("CERES").isTestParticle());
        assertFalse(MinorBodyCatalog.get("VESTA").isTestParticle());
        // NEAs are test particles.
        assertTrue(MinorBodyCatalog.get("EROS").isTestParticle());
        assertTrue(MinorBodyCatalog.get("APOPHIS").isTestParticle());
        assertTrue(MinorBodyCatalog.get("BENNU").isTestParticle());
        assertTrue(MinorBodyCatalog.get("RYUGU").isTestParticle());
    }

    @Test
    void spkIdMappingsAreSet() {
        assertEquals("2000433", MinorBodyCatalog.get("EROS").spkId());
        assertEquals("2099942", MinorBodyCatalog.get("APOPHIS").spkId());
        // Pluto has no SPK ID — sourced via Orekit.
        assertNull(MinorBodyCatalog.get("PLUTO").spkId());
    }

    @Test
    void lookupIsCaseInsensitive() {
        assertNotNull(MinorBodyCatalog.get("eros"));
        assertNotNull(MinorBodyCatalog.get("Eros"));
        assertTrue(MinorBodyCatalog.isMinorBody("ceres"));
    }

    @Test
    void unknownReturnsNull() {
        assertFalse(MinorBodyCatalog.isMinorBody("XYZZY"));
        assertNull(MinorBodyCatalog.get("XYZZY"));
    }
}
