package personal.spacesim.simulation.body;

import java.util.Set;

/**
 * Authoritative check for whether a requested body name is in the simulator's
 * catalog. Used to validate {@code /initialize} input before any session is
 * built — an unbounded or garbage body list is the cheapest OOM/compute DoS
 * vector on a small VM (the force model is O(N^2) per step over a 10k-step
 * chunk).
 *
 * <p>The catalog is the union of:
 * <ul>
 *   <li>Orekit-sourced majors: the Sun, the 8 planets, and Earth's Moon
 *       (PLUTO is covered via {@link MinorBodyCatalog}, Orekit-sourced).</li>
 *   <li>{@link MoonCatalog} — the 21 named major moons.</li>
 *   <li>{@link MinorBodyCatalog} — dwarf planets + named near-Earth asteroids.</li>
 * </ul>
 * Mirrors the dispatch in {@code CelestialBodyWrapperFactory}; if a routing
 * path is added there, extend this set so validation stays in agreement.
 */
public final class BodyCatalog {

    private BodyCatalog() {}

    /**
     * Hard cap on bodies per simulation. The full catalog is 40; this leaves
     * headroom for catalog growth while still killing the "thousands of names"
     * vector. (At N=50 the force model is ~2500 pair-ops/step — trivial; the
     * vector only becomes a problem in the thousands.)
     */
    public static final int MAX_BODIES_PER_SIM = 50;

    // Orekit DE-440 path in CelestialBodyWrapperFactory: the Sun, 8 planets,
    // and Earth's Moon. PLUTO is resolved via MinorBodyCatalog (Orekit-sourced),
    // so it is intentionally not listed here.
    private static final Set<String> MAJOR_BODIES = Set.of(
            "SUN", "MERCURY", "VENUS", "EARTH", "MARS",
            "JUPITER", "SATURN", "URANUS", "NEPTUNE", "MOON"
    );

    /** True if {@code name} resolves to a known body (case-insensitive). */
    public static boolean isKnown(String name) {
        if (name == null || name.isBlank()) return false;
        String upper = name.trim().toUpperCase();
        return MAJOR_BODIES.contains(upper)
                || MoonCatalog.get(upper) != null
                || MinorBodyCatalog.get(upper) != null;
    }
}
