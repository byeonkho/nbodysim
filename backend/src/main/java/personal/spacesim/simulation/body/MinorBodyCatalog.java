package personal.spacesim.simulation.body;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Catalog of minor bodies (dwarf planets + named near-Earth asteroids)
 * not part of the planet-set covered by Orekit's bundled DE-440.
 *
 * <p>Each entry carries body-constant data: GM (m^3/s^2), mean radius (m),
 * JPL SPK ID (for Horizons HTTP queries), and physics classification
 * (massive vs test particle).
 *
 * <p>Initial state vectors are NOT stored here — they come from JPL
 * Horizons at sim-submit time via {@link horizons.HorizonsClient}.
 * Hardcoding state at a single epoch would tie us to that epoch; querying
 * Horizons lets each sim start at the user's chosen date with high-fidelity
 * initial conditions.
 *
 * <p>PLUTO is included with {@code spkId = null} since DE-440 covers it
 * directly via Orekit's {@code CelestialBodyFactory}; the factory routes
 * by name and skips Horizons for Pluto.
 */
public final class MinorBodyCatalog {

    /** All units SI: GM in m^3/s^2, radius in m. */
    public record Entry(
            String name,
            String spkId,            // null when Orekit-sourced (PLUTO)
            double mu,
            double radius,
            boolean isTestParticle
    ) {
        public boolean isOrekitSourced() { return spkId == null; }
    }

    private static final List<Entry> ENTRIES = Arrays.asList(
            // PLUTO: Orekit DE-440 covers it. GM/radius from JPL fact sheet.
            new Entry("PLUTO", null, 8.696e11, 1_188_300.0, false),

            // Dwarf planets & largest main-belt asteroids (massive).
            new Entry("CERES",  "2000001", 6.262e10, 469_700.0, false),
            new Entry("VESTA",  "2000004", 1.728e10, 262_700.0, false),
            new Entry("PALLAS", "2000002", 1.398e10, 256_000.0, false),
            new Entry("HYGIEA", "2000010", 5.778e9,  215_000.0, false),

            // Near-Earth asteroids (test particles).
            new Entry("EROS",    "2000433", 4.463e5, 8_420.0, true),
            new Entry("APOPHIS", "2099942", 1.8e3,   185.0,   true),
            new Entry("BENNU",   "2101955", 5.2,     245.0,   true),
            new Entry("RYUGU",   "2162173", 30.0,    435.0,   true)
    );

    public static final Map<String, Entry> ALL = ENTRIES.stream()
            .collect(Collectors.toUnmodifiableMap(Entry::name, e -> e));

    public static Entry get(String name) {
        if (name == null) return null;
        return ALL.get(name.toUpperCase());
    }

    public static boolean isMinorBody(String name) {
        if (name == null) return false;
        return ALL.containsKey(name.toUpperCase());
    }

    private MinorBodyCatalog() {}
}
