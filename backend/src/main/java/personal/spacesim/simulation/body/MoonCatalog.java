package personal.spacesim.simulation.body;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Catalog of the 21 named major moons sourced via JPL Horizons.
 *
 * <p>Earth's Moon is intentionally NOT in this catalog — it's Orekit-sourced
 * via DE-440 and keeps its existing render path. This catalog only contains
 * moons that need Horizons fetching.
 *
 * <p>Each entry carries body-constant data: NAIF ID (bare numeric, e.g. "501"
 * for Io — Horizons accepts this directly without the DES=...; wrapper that
 * minor-body asteroid SPK IDs require), µ (m³/s²), mean radius (m), parent
 * planet name (uppercase), and physics classification (massive vs test
 * particle).
 *
 * <p>Initial state vectors come from JPL Horizons at sim-submit time via
 * {@link horizons.HorizonsClient#fetchByMajorBodyId}.
 *
 * <p>Massive moons (8 total, including the existing Earth's Moon): Moon, Io,
 * Europa, Ganymede, Callisto, Titan, Triton, Charon. These contribute to
 * mutual gravity in their systems — Galileans preserve the Laplace 4:2:1
 * resonance, Titan dominates Saturn's system, Triton is Neptune's biggest,
 * Charon makes the Pluto-Charon barycenter dance work. The remaining 14
 * are test particles.
 */
public final class MoonCatalog {

    /** All units SI: GM in m³/s², radius in m. */
    public record Entry(
            String name,
            String naifId,
            double mu,
            double radius,
            String parent,
            boolean isTestParticle
    ) {}

    private static final List<Entry> ENTRIES = Arrays.asList(
            // Mars
            new Entry("PHOBOS", "401", 7.11e2, 11_267, "MARS", true),
            new Entry("DEIMOS", "402", 9.85e1, 6_200,  "MARS", true),

            // Jupiter — Galileans (all massive)
            new Entry("IO",       "501", 5.96e12, 1_821_600, "JUPITER", false),
            new Entry("EUROPA",   "502", 3.20e12, 1_560_800, "JUPITER", false),
            new Entry("GANYMEDE", "503", 9.89e12, 2_634_100, "JUPITER", false),
            new Entry("CALLISTO", "504", 7.18e12, 2_410_300, "JUPITER", false),

            // Saturn — Titan is massive, the rest are test particles
            new Entry("MIMAS",     "601", 2.50e9,  198_200, "SATURN", true),
            new Entry("ENCELADUS", "602", 7.21e9,  252_100, "SATURN", true),
            new Entry("TETHYS",    "603", 4.12e10, 531_100, "SATURN", true),
            new Entry("DIONE",     "604", 7.31e10, 561_400, "SATURN", true),
            new Entry("RHEA",      "605", 1.54e11, 763_800, "SATURN", true),
            new Entry("TITAN",     "606", 8.98e12, 2_574_700, "SATURN", false),
            new Entry("IAPETUS",   "608", 1.21e11, 734_500, "SATURN", true),

            // Uranus — all five major moons are test particles
            new Entry("ARIEL",   "701", 8.34e10, 578_900, "URANUS", true),
            new Entry("UMBRIEL", "702", 8.55e10, 584_700, "URANUS", true),
            new Entry("TITANIA", "703", 2.27e11, 788_400, "URANUS", true),
            new Entry("OBERON",  "704", 2.06e11, 761_400, "URANUS", true),
            new Entry("MIRANDA", "705", 4.40e9,  235_800, "URANUS", true),

            // Neptune
            new Entry("TRITON", "801", 1.43e12, 1_353_400, "NEPTUNE", false),
            new Entry("NEREID", "802", 2.06e9,  170_000,   "NEPTUNE", true),

            // Pluto
            new Entry("CHARON", "901", 1.06e11, 606_000, "PLUTO", false)
    );

    public static final Map<String, Entry> ALL = ENTRIES.stream()
            .collect(Collectors.toUnmodifiableMap(Entry::name, e -> e));

    public static Entry get(String name) {
        if (name == null) return null;
        return ALL.get(name.toUpperCase());
    }

    public static boolean isMoon(String name) {
        if (name == null) return false;
        return ALL.containsKey(name.toUpperCase());
    }

    private MoonCatalog() {}
}
