package personal.spacesim.simulation.body;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the validation catalog. This must agree with the routing in
 * {@code CelestialBodyWrapperFactory} — a name the factory can build but
 * validation rejects would 400 a legitimate request; a name validation
 * accepts but the factory can't build would 500 / leak through the cap.
 */
class BodyCatalogTest {

    @Test
    void acceptsOrekitMajors() {
        assertTrue(BodyCatalog.isKnown("SUN"));
        assertTrue(BodyCatalog.isKnown("EARTH"));
        assertTrue(BodyCatalog.isKnown("NEPTUNE"));
        assertTrue(BodyCatalog.isKnown("MOON")); // Earth's Moon, Orekit-sourced
    }

    @Test
    void acceptsMoonsAndMinorBodies() {
        assertTrue(BodyCatalog.isKnown("TITAN"));  // MoonCatalog
        assertTrue(BodyCatalog.isKnown("IO"));     // MoonCatalog
        assertTrue(BodyCatalog.isKnown("CERES"));  // MinorBodyCatalog
        assertTrue(BodyCatalog.isKnown("PLUTO"));  // MinorBodyCatalog (Orekit-sourced)
        assertTrue(BodyCatalog.isKnown("APOPHIS")); // MinorBodyCatalog (NEA)
    }

    @Test
    void isCaseInsensitiveAndTrims() {
        assertTrue(BodyCatalog.isKnown("earth"));
        assertTrue(BodyCatalog.isKnown("  Jupiter  "));
    }

    @Test
    void rejectsUnknownAndEmpty() {
        assertFalse(BodyCatalog.isKnown("NIBIRU"));
        assertFalse(BodyCatalog.isKnown("DEATH STAR"));
        assertFalse(BodyCatalog.isKnown(""));
        assertFalse(BodyCatalog.isKnown("   "));
        assertFalse(BodyCatalog.isKnown(null));
    }
}
