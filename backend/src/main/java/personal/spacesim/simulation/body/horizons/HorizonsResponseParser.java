package personal.spacesim.simulation.body.horizons;

import org.hipparchus.geometry.euclidean.threed.Vector3D;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses the JPL Horizons text-format ephemeris response. The relevant
 * portion is bounded by {@code $$SOE} (Start Of Ephemeris) and
 * {@code $$EOE} (End Of Ephemeris). Each record is 3 lines:
 *
 * <pre>
 * 2451545.000000000 = A.D. 2000-Jan-01 12:00:00.0000 TDB
 *  X =-2.671894...E+08 Y = 1.466517...E+08 Z = 4.832102...E+07
 *  VX=-9.214829...E+00 VY=-2.181472...E+01 VZ=-9.273981...E+00
 * </pre>
 *
 * <p>Units: km and km/s when the query specifies {@code OUT_UNITS='KM-S'}.
 * The parser returns SI (m, m/s).
 *
 * <p>This runs at sim-submit time (once per minor body), not per timestep,
 * so the regex/string-allocation cost is irrelevant to the hot path.
 */
public final class HorizonsResponseParser {

    public record State(Vector3D position, Vector3D velocity) {}

    // Numbers in Horizons output may have an optional leading space or minus
    // sign right after the "=", e.g. "X =-1.234E+08" or "X = 1.234E+08".
    private static final String NUM = "(-?\\d+\\.\\d+E[+-]?\\d+)";

    private static final Pattern POS_PATTERN = Pattern.compile(
        "\\s*X\\s*=\\s*" + NUM + "\\s+Y\\s*=\\s*" + NUM + "\\s+Z\\s*=\\s*" + NUM);
    private static final Pattern VEL_PATTERN = Pattern.compile(
        "\\s*VX\\s*=\\s*" + NUM + "\\s+VY\\s*=\\s*" + NUM + "\\s+VZ\\s*=\\s*" + NUM);

    /**
     * Max chars of the response body to include in failure exceptions.
     * JPL error messages (e.g. "No ephemeris for target ..." or "DXREAD:
     * requested IOBJ ... is out of bounds") are typically &lt; 500 chars;
     * anything longer is usually HTML or noise that would just bloat
     * logs.
     */
    private static final int ERROR_PREVIEW_MAX_CHARS = 800;

    public static State parseFirstRecord(String responseText) {
        int soe = responseText.indexOf("$$SOE");
        int eoe = responseText.indexOf("$$EOE");
        if (soe < 0 || eoe < 0 || eoe < soe) {
            // Include a bounded slice of the response so logs surface JPL's
            // actual error (e.g. "No ephemeris for target ..." for a
            // misformed COMMAND) rather than a generic missing-markers
            // message.
            throw new IllegalArgumentException(
                "Horizons response missing $$SOE / $$EOE markers; response: "
                    + preview(responseText));
        }
        String block = responseText.substring(soe + 5, eoe);

        Matcher pos = POS_PATTERN.matcher(block);
        Matcher vel = VEL_PATTERN.matcher(block);
        if (!pos.find()) {
            throw new IllegalArgumentException(
                "No X/Y/Z line in Horizons block: " + preview(block));
        }
        if (!vel.find()) {
            throw new IllegalArgumentException(
                "No VX/VY/VZ line in Horizons block: " + preview(block));
        }

        // Horizons returns km, km/s when OUT_UNITS='KM-S'. Convert to SI.
        double x  = Double.parseDouble(pos.group(1)) * 1000.0;
        double y  = Double.parseDouble(pos.group(2)) * 1000.0;
        double z  = Double.parseDouble(pos.group(3)) * 1000.0;
        double vx = Double.parseDouble(vel.group(1)) * 1000.0;
        double vy = Double.parseDouble(vel.group(2)) * 1000.0;
        double vz = Double.parseDouble(vel.group(3)) * 1000.0;

        return new State(new Vector3D(x, y, z), new Vector3D(vx, vy, vz));
    }

    private static String preview(String text) {
        if (text == null) return "(null)";
        if (text.length() <= ERROR_PREVIEW_MAX_CHARS) return text;
        return text.substring(0, ERROR_PREVIEW_MAX_CHARS) + "...[truncated]";
    }

    private HorizonsResponseParser() {}
}
