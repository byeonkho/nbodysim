package personal.spacesim.constants;
import lombok.Getter;
import org.orekit.utils.Constants;

import java.util.HashMap;
import java.util.Map;

@Getter
public class PhysicsConstants {
    public static final double GRAVITATIONAL_CONSTANT = 6.67430e-11; // in m^3 kg^-1 s^-2
    public static final double SECONDS_PER_HOUR = 3600;
    public static final double SECONDS_PER_DAY = 86400;
    public static final double SECONDS_PER_WEEK = 604800;

    public static final Map<String, Double> RADIUS_MAP = new HashMap<>();
    static {
        RADIUS_MAP.put("EARTH",    6_378_136.3);
        RADIUS_MAP.put("MARS",     3_389_500.0);
        RADIUS_MAP.put("MOON",     1_737_400.0);
        RADIUS_MAP.put("SUN",    695_700_000.0);
        RADIUS_MAP.put("VENUS",    6_051_800.0);
        RADIUS_MAP.put("MERCURY",  2_439_700.0);
        RADIUS_MAP.put("JUPITER", 71_492_000.0);
        RADIUS_MAP.put("SATURN",  58_232_000.0);
        RADIUS_MAP.put("URANUS",  25_362_000.0);
        RADIUS_MAP.put("NEPTUNE", 24_622_000.0);

        // Minor bodies — dwarf planets and named near-Earth asteroids.
        RADIUS_MAP.put("PLUTO",    1_188_300.0);
        RADIUS_MAP.put("CERES",      469_700.0);
        RADIUS_MAP.put("VESTA",      262_700.0);
        RADIUS_MAP.put("PALLAS",     256_000.0);
        RADIUS_MAP.put("HYGIEA",     215_000.0);
        RADIUS_MAP.put("EROS",         8_420.0);
        RADIUS_MAP.put("APOPHIS",        185.0);
        RADIUS_MAP.put("BENNU",          245.0);
        RADIUS_MAP.put("RYUGU",          435.0);
    }

    private PhysicsConstants() {
    }
}