package personal.spacesim.utils.serializers;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Serializes {@link Map<AbsoluteDate, List<CelestialBodySnapshot>>} payloads into a compact
 * little-endian binary layout. Replaces the JSON path for SIM_DATA frames.
 *
 * Layout (all little-endian):
 *   uint16  bodyCount
 *   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
 *   uint32  timestepCount
 *   per timestep:
 *     int64    timestamp (millis since UNIX epoch, UTC)
 *     per body (in header order):
 *       float32 × 6   (px, py, pz, vx, vy, vz)
 *
 * Positions + velocities use float32 — ~7-decimal-digit precision is fine
 * for visualisation (the Keplerian-element math is performed once per body
 * card render, not in the integrator, so input precision dominates over
 * derivative-amplified rounding). Halves raw per-timestep bytes.
 *
 * Body names + µ (standard gravitational parameter, m³/s²) are sent once in
 * the header; per-timestep payloads use header-order indexing. µ stays
 * float64 because it appears once per session per body (not per timestep)
 * and the Keplerian derivation is sensitive to µ precision in a way the
 * positions aren't. µ is needed client-side to derive Keplerian orbital
 * elements from (r, v) state vectors; inlining it avoids a separate metadata
 * fetch and is constant per session so resending per chunk costs only
 * bodyCount × 8 bytes (~80 B for 10 bodies).
 *
 * Assumes a stable body order across timesteps within a chunk, which the
 * integrator guarantees.
 */
@Component
public class BinaryResponseSerializer {

    public byte[] serialize(
            Map<AbsoluteDate, List<CelestialBodySnapshot>> data,
            Map<String, Double> muByName
    ) {
        if (data == null || data.isEmpty()) {
            ByteBuffer empty = ByteBuffer.allocate(2 + 4).order(ByteOrder.LITTLE_ENDIAN);
            empty.putShort((short) 0);
            empty.putInt(0);
            return empty.array();
        }

        // Body order is taken from the first timestep — stable across timesteps within a chunk.
        List<CelestialBodySnapshot> firstSnapshot = data.values().iterator().next();
        int bodyCount = firstSnapshot.size();

        byte[][] nameBytes = new byte[bodyCount][];
        int headerSize = 2 + 4; // bodyCount + timestepCount
        for (int i = 0; i < bodyCount; i++) {
            nameBytes[i] = firstSnapshot.get(i).name().getBytes(StandardCharsets.UTF_8);
            // 2 (nameLen) + name bytes + 8 (µ as float64)
            headerSize += 2 + nameBytes[i].length + 8;
        }

        int timestepCount = data.size();
        // timestamp (int64) + 6 floats (float32) per body
        int perTimestepSize = 8 + bodyCount * 6 * 4;
        int totalSize = headerSize + timestepCount * perTimestepSize;

        ByteBuffer buf = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN);

        // Header
        buf.putShort((short) bodyCount);
        for (int i = 0; i < bodyCount; i++) {
            String bodyName = firstSnapshot.get(i).name();
            buf.putShort((short) nameBytes[i].length);
            buf.put(nameBytes[i]);
            // µ for this body. Missing entries fall through to 0.0 — frontend
            // treats µ=0 as "unknown" and skips Keplerian-element rendering
            // for that body rather than producing NaN/inf cascades.
            Double mu = muByName != null ? muByName.get(bodyName) : null;
            buf.putDouble(mu != null ? mu : 0.0);
        }
        buf.putInt(timestepCount);

        // Per-timestep body
        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> entry : data.entrySet()) {
            long millis = entry.getKey().toDate(TimeScalesFactory.getUTC()).getTime();
            buf.putLong(millis);

            List<CelestialBodySnapshot> snapshot = entry.getValue();
            for (int i = 0; i < bodyCount; i++) {
                Vector3D pos = snapshot.get(i).position();
                Vector3D vel = snapshot.get(i).velocity();
                buf.putFloat((float) pos.getX()).putFloat((float) pos.getY()).putFloat((float) pos.getZ());
                buf.putFloat((float) vel.getX()).putFloat((float) vel.getY()).putFloat((float) vel.getZ());
            }
        }

        return buf.array();
    }
}
