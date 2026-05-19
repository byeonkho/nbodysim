package personal.spacesim.utils.serializers;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Dp853Telemetry;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Serializes a {@link ChunkResult} into a compact little-endian binary
 * layout. Replaces the JSON path for SIM_DATA frames.
 *
 * Layout (all little-endian):
 *   uint16  bodyCount
 *   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
 *   float64 dp853AvgStepSeconds      (NaN if not DP853)
 *   float32 dp853AcceptRate          (NaN if not DP853)
 *   uint32  timestepCount
 *   per timestep:
 *     int64    timestamp (millis since UNIX epoch, UTC)
 *     float32  deltaERelative        (E - E₀) / |E₀| at this snapshot
 *     per body (header order):
 *       float64 × 3   (px, py, pz)
 *       float32 × 3   (vx, vy, vz)
 *
 * Always-written DP853 fields (NaN-encoded when not applicable) keep the
 * parser branchless. ~0.4% overhead on chunk size for DP853 chunks
 * (12 B header + 4 B per snapshot, ~20 KB at 5000-snapshot chunks).
 *
 * Mixed precision (post trail-wobble investigation): positions need
 * float64 because their quantization is rendered directly — float32's
 * ~540 km cells at Neptune's 4.5×10¹² m radius dominated per-sample Z
 * motion at high fidelity, causing visible orbit-plane jitter. Velocities
 * are fine at float32: their use sites (Hermite tangent → position over
 * one gap-interval; Keplerian v² → semi-major axis) damp the precision
 * loss by ~5 orders of magnitude before anything visible. Per-snapshot
 * ΔE/E₀ is also float32 — it's a UI readout (1-2 sig figs).
 *
 * Body names + µ (standard gravitational parameter, m³/s²) are sent once in
 * the header; per-timestep payloads use header-order indexing. µ is needed
 * client-side to derive Keplerian orbital elements from (r, v) state vectors;
 * inlining it avoids a separate metadata fetch and is constant per session
 * so resending per chunk costs only bodyCount × 8 bytes (~80 B for 10 bodies).
 *
 * Assumes a stable body order across timesteps within a chunk, which the
 * integrator guarantees.
 */
@Component
public class BinaryResponseSerializer {

    public byte[] serialize(ChunkResult chunk, Map<String, Double> muByName) {
        Map<AbsoluteDate, List<CelestialBodySnapshot>> data =
                chunk != null ? chunk.snapshots() : null;
        Map<AbsoluteDate, Double> deltaE =
                chunk != null ? chunk.deltaERelative() : null;
        Dp853Telemetry telemetry =
                chunk != null ? chunk.telemetry() : null;

        if (data == null || data.isEmpty()) {
            // bodyCount(2) + dp853AvgStep(8) + dp853AcceptRate(4) + timestepCount(4) = 18
            ByteBuffer empty = ByteBuffer.allocate(18).order(ByteOrder.LITTLE_ENDIAN);
            empty.putShort((short) 0);
            empty.putDouble(Double.NaN);
            empty.putFloat(Float.NaN);
            empty.putInt(0);
            return empty.array();
        }

        // Body order is taken from the first timestep — stable across timesteps within a chunk.
        List<CelestialBodySnapshot> firstSnapshot = data.values().iterator().next();
        int bodyCount = firstSnapshot.size();

        byte[][] nameBytes = new byte[bodyCount][];
        // bodyCount(2) + bodies + dp853AvgStep(8) + dp853AcceptRate(4) + timestepCount(4)
        int headerSize = 2 + 8 + 4 + 4;
        for (int i = 0; i < bodyCount; i++) {
            nameBytes[i] = firstSnapshot.get(i).name().getBytes(StandardCharsets.UTF_8);
            // 2 (nameLen) + name bytes + 8 (µ as float64)
            headerSize += 2 + nameBytes[i].length + 8;
        }

        int timestepCount = data.size();
        // timestamp(8) + deltaERelative(4) + per body: 3 doubles (position) + 3 floats (velocity)
        int perTimestepSize = 8 + 4 + bodyCount * (3 * 8 + 3 * 4);
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
        // DP853 telemetry — NaN-encoded when not applicable so the parser
        // can read the fields branchlessly and map NaN → null downstream.
        buf.putDouble(telemetry != null ? telemetry.avgStepSeconds() : Double.NaN);
        buf.putFloat(telemetry != null ? (float) telemetry.acceptRate() : Float.NaN);
        buf.putInt(timestepCount);

        // Per-timestep body
        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> entry : data.entrySet()) {
            AbsoluteDate date = entry.getKey();
            long millis = date.toDate(TimeScalesFactory.getUTC()).getTime();
            buf.putLong(millis);

            Double dE = deltaE != null ? deltaE.get(date) : null;
            buf.putFloat(dE != null ? dE.floatValue() : 0.0f);

            List<CelestialBodySnapshot> snapshot = entry.getValue();
            for (int i = 0; i < bodyCount; i++) {
                Vector3D pos = snapshot.get(i).position();
                Vector3D vel = snapshot.get(i).velocity();
                buf.putDouble(pos.getX()).putDouble(pos.getY()).putDouble(pos.getZ());
                buf.putFloat((float) vel.getX()).putFloat((float) vel.getY()).putFloat((float) vel.getZ());
            }
        }

        return buf.array();
    }
}
