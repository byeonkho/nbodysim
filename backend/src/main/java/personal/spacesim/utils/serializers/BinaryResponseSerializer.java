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
 *   per body: uint16 nameLength, UTF-8 name bytes
 *   uint32  timestepCount
 *   per timestep:
 *     int64    timestamp (millis since UNIX epoch, UTC)
 *     per body (in header order):
 *       float64 × 6   (px, py, pz, vx, vy, vz)
 *
 * Body names are sent once in the header; per-timestep payloads use header-order
 * indexing. Assumes a stable body order across timesteps within a chunk, which
 * the integrator guarantees.
 */
@Component
public class BinaryResponseSerializer {

    public byte[] serialize(Map<AbsoluteDate, List<CelestialBodySnapshot>> data) {
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
            headerSize += 2 + nameBytes[i].length;
        }

        int timestepCount = data.size();
        int perTimestepSize = 8 + bodyCount * 6 * 8; // timestamp + 6 doubles per body
        int totalSize = headerSize + timestepCount * perTimestepSize;

        ByteBuffer buf = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN);

        // Header
        buf.putShort((short) bodyCount);
        for (int i = 0; i < bodyCount; i++) {
            buf.putShort((short) nameBytes[i].length);
            buf.put(nameBytes[i]);
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
                buf.putDouble(pos.getX()).putDouble(pos.getY()).putDouble(pos.getZ());
                buf.putDouble(vel.getX()).putDouble(vel.getY()).putDouble(vel.getZ());
            }
        }

        return buf.array();
    }
}
