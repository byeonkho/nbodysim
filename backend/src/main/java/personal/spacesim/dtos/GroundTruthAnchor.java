package personal.spacesim.dtos;

/**
 * One sparse true-position sample for a body. Position + velocity are
 * Sun-relative, in metres / metres-per-second, expressed in the session's
 * frame (same convention as the binary wire format's snapshots). Velocity
 * is included so the client can Hermite-interpolate exactly between anchors.
 *
 * @param epochMillis millis since the Unix epoch (UTC) — produced via
 *                    {@code date.toDate(TimeScalesFactory.getUTC()).getTime()},
 *                    identical to the binary serializer, so anchor timestamps
 *                    align with predicted-keyframe timestamps on the client.
 * @param position    [x, y, z] in metres, Sun-relative.
 * @param velocity    [vx, vy, vz] in metres/second, Sun-relative.
 */
public record GroundTruthAnchor(
        long epochMillis,
        double[] position,
        double[] velocity
) {}
