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
 * <h2>Format version 3 — byte-shuffled planes, velocity temporal-delta</h2>
 *
 * Layout (all little-endian):
 * <pre>
 *   uint8   formatVersion (= 3)
 *   uint16  bodyCount (B)
 *   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
 *   float64 dp853AvgStepSeconds      (NaN if not DP853)
 *   float32 dp853AcceptRate          (NaN if not DP853)
 *   uint32  timestepCount (T)
 *   — the rest is present only when T &gt; 0 —
 *   int64   startMillis              (timestamp of timestep 0, millis UTC)
 *   float64 gapMillis                (uniform spacing; ts[i] = round(startMillis + i*gapMillis))
 *   float32 deltaERelative[T]        (planar, UNSHUFFLED; one per timestep)
 *   per body: float64 refX, refY, refZ   (absolute position at timestep 0, UNSHUFFLED)
 *   SHUFFLED float32 dPx[T*B]        (per-step position deltas, planar; row 0 = 0)
 *   SHUFFLED float32 dPy[T*B]
 *   SHUFFLED float32 dPz[T*B]
 *   SHUFFLED float32 vx[T*B]         (velocity temporal-delta: row 0 absolute, rows 1..T-1 = step deltas)
 *   SHUFFLED float32 vy[T*B]
 *   SHUFFLED float32 vz[T*B]
 * </pre>
 *
 * "SHUFFLED float32 plane of N values" occupies N*4 bytes, rearranged: byte p
 * of value i lands at offset p*N + i. So all byte-0s first (N bytes), then all
 * byte-1s, then byte-2s, then byte-3s. The client un-shuffles before consuming.
 *
 * <h2>Why this shape (bandwidth audit)</h2>
 *
 * The previous interleaved float64-position layout was ~65% incompressible
 * mantissa bytes, so zstd recovered only ~15% (a near-no-op). Three changes
 * make the bytes compressible and smaller while keeping the on-screen result
 * indistinguishable:
 *
 * <ul>
 *   <li><b>Temporal delta in float32.</b> Positions are sent as a per-body
 *       absolute float64 reference (timestep 0) plus per-step float32 deltas.
 *       Each step's motion is tiny, so float32 describes the <i>delta</i> with
 *       headroom to spare; the client reconstructs absolute positions by prefix
 *       sum in float64. Worst-case accumulated error measured at &lt;1 km across
 *       the full body catalog — ~700× finer than the ~540 km that absolute
 *       float32 produced at Neptune's radius, and it manifests as slow sub-km
 *       drift rather than the per-sample jitter that ruled out absolute
 *       float32. Each chunk carries its own reference row, so chunks stay
 *       independently decodable and the error resets per chunk (never
 *       accumulates across chunk seams).</li>
 *   <li><b>Structure-of-arrays (planar) layout.</b> Grouping like-magnitude
 *       values into contiguous runs lets zstd find the redundancy the
 *       interleaved layout hid.</li>
 *   <li><b>Uniform-cadence timestamps.</b> Emission spacing is uniform, so a
 *       single (startMillis, gapMillis) replaces a per-timestep int64. The
 *       client reconstructs each timestamp by rounding; accurate to ~1 ms,
 *       invisible everywhere it's used (date readout, Hermite interval).</li>
 *   <li><b>Byte-plane shuffle.</b> Each float32 plane's 4 bytes are split into
 *       4 contiguous runs, so zstd compresses the stable high-order bytes (which
 *       are often identical across adjacent steps) without interleaving
 *       noise from the low-order bytes.</li>
 *   <li><b>Velocity temporal-delta.</b> Row 0 carries the absolute velocity;
 *       rows 1..T-1 carry per-step deltas. Smooth orbital velocity produces tiny
 *       deltas, which are highly compressible after shuffling. Worst-case
 *       reconstruction drift measured at ~0.02 m/s.</li>
 * </ul>
 *
 * Per-snapshot ΔE/E₀ stays float32 unshuffled — a UI readout shown to 1-2 sig
 * figs. Body names + µ are sent once in the header; µ is needed client-side to
 * derive Keplerian elements from (r, v).
 *
 * <p>Assumes a stable body order across timesteps within a chunk, which the
 * integrator guarantees.
 *
 * <p>This is the hot serialization path (loops over all timesteps × all
 * bodies). The first pass extracts primitive arrays once (pre-sized, no
 * per-element allocation); subsequent passes write planar sections directly
 * into a single pre-sized buffer.
 */
@Component
public class BinaryResponseSerializer {

    /** Wire format version. Bump on any layout change; the parser branches on it. */
    public static final int FORMAT_VERSION = 3;

    public byte[] serialize(ChunkResult chunk, Map<String, Double> muByName) {
        Map<AbsoluteDate, List<CelestialBodySnapshot>> data =
                chunk != null ? chunk.snapshots() : null;
        Map<AbsoluteDate, Double> deltaE =
                chunk != null ? chunk.deltaERelative() : null;
        Dp853Telemetry telemetry =
                chunk != null ? chunk.telemetry() : null;

        if (data == null || data.isEmpty()) {
            // version(1) + bodyCount(2) + dp853AvgStep(8) + dp853AcceptRate(4)
            // + timestepCount(4) = 19. No start/gap/body sections when T == 0.
            ByteBuffer empty = ByteBuffer.allocate(19).order(ByteOrder.LITTLE_ENDIAN);
            empty.put((byte) FORMAT_VERSION);
            empty.putShort((short) 0);
            empty.putDouble(Double.NaN);
            empty.putFloat(Float.NaN);
            empty.putInt(0);
            return empty.array();
        }

        // Body order is taken from the first timestep — stable across timesteps.
        List<CelestialBodySnapshot> firstSnapshot = data.values().iterator().next();
        int bodyCount = firstSnapshot.size();
        int timestepCount = data.size();

        // --- pass 1: extract flat primitive arrays (one allocation each) ---
        // px[t*B + b], etc. Velocities cast to float here so the delta/ref math
        // and the wire agree exactly on what the client will see.
        double[] px = new double[timestepCount * bodyCount];
        double[] py = new double[timestepCount * bodyCount];
        double[] pz = new double[timestepCount * bodyCount];
        float[] vx = new float[timestepCount * bodyCount];
        float[] vy = new float[timestepCount * bodyCount];
        float[] vz = new float[timestepCount * bodyCount];
        long[] millis = new long[timestepCount];
        float[] dE = new float[timestepCount];

        int t = 0;
        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> entry : data.entrySet()) {
            AbsoluteDate date = entry.getKey();
            millis[t] = date.toDate(TimeScalesFactory.getUTC()).getTime();
            Double d = deltaE != null ? deltaE.get(date) : null;
            dE[t] = d != null ? d.floatValue() : 0.0f;

            List<CelestialBodySnapshot> snapshot = entry.getValue();
            for (int b = 0; b < bodyCount; b++) {
                int idx = t * bodyCount + b;
                Vector3D pos = snapshot.get(b).position();
                Vector3D vel = snapshot.get(b).velocity();
                px[idx] = pos.getX();
                py[idx] = pos.getY();
                pz[idx] = pos.getZ();
                vx[idx] = (float) vel.getX();
                vy[idx] = (float) vel.getY();
                vz[idx] = (float) vel.getZ();
            }
            t++;
        }

        long startMillis = millis[0];
        // Best-fit uniform spacing (float64 ms). Averaging first→last cancels
        // the per-date ms rounding; interior timestamps reconstruct within ~1 ms.
        double gapMillis = timestepCount > 1
                ? (double) (millis[timestepCount - 1] - startMillis) / (timestepCount - 1)
                : 0.0;

        // --- size + allocate the single output buffer ---
        byte[][] nameBytes = new byte[bodyCount][];
        int headerSize = 1 + 2 + 8 + 4 + 4;          // version, bodyCount, dp853 avg+rate, count
        for (int b = 0; b < bodyCount; b++) {
            nameBytes[b] = firstSnapshot.get(b).name().getBytes(StandardCharsets.UTF_8);
            headerSize += 2 + nameBytes[b].length + 8;   // nameLen + name + mu
        }
        int bodySection =
                8 + 8                                  // startMillis + gapMillis
                + timestepCount * 4                    // deltaE planar
                + bodyCount * 3 * 8                     // per-body f64 reference
                + timestepCount * bodyCount * 3 * 4     // f32 position deltas (planar)
                + timestepCount * bodyCount * 3 * 4;    // f32 velocity (planar)
        ByteBuffer buf = ByteBuffer
                .allocate(headerSize + bodySection)
                .order(ByteOrder.LITTLE_ENDIAN);

        // --- header ---
        buf.put((byte) FORMAT_VERSION);
        buf.putShort((short) bodyCount);
        for (int b = 0; b < bodyCount; b++) {
            buf.putShort((short) nameBytes[b].length);
            buf.put(nameBytes[b]);
            // µ for this body. Missing entries fall through to 0.0 — the frontend
            // treats µ=0 as "unknown" and skips Keplerian-element rendering for
            // that body rather than producing NaN/inf cascades.
            String bodyName = firstSnapshot.get(b).name();
            Double mu = muByName != null ? muByName.get(bodyName) : null;
            buf.putDouble(mu != null ? mu : 0.0);
        }
        // DP853 telemetry — NaN-encoded when not applicable so the parser reads
        // the fields branchlessly and maps NaN → null downstream.
        buf.putDouble(telemetry != null ? telemetry.avgStepSeconds() : Double.NaN);
        buf.putFloat(telemetry != null ? (float) telemetry.acceptRate() : Float.NaN);
        buf.putInt(timestepCount);

        // --- body section (planar) ---
        buf.putLong(startMillis);
        buf.putDouble(gapMillis);

        for (int i = 0; i < timestepCount; i++) {
            buf.putFloat(dE[i]);
        }

        // Per-body absolute reference (timestep 0).
        for (int b = 0; b < bodyCount; b++) {
            buf.putDouble(px[b]).putDouble(py[b]).putDouble(pz[b]);
        }

        // Per-step position deltas, planar by axis, byte-plane shuffled.
        // Row 0 is zero (the per-body f64 reference carries timestep 0).
        putShuffledStepDeltas(buf, px, timestepCount, bodyCount);
        putShuffledStepDeltas(buf, py, timestepCount, bodyCount);
        putShuffledStepDeltas(buf, pz, timestepCount, bodyCount);

        // Velocity, planar by axis, temporal-delta (row 0 absolute), byte-plane
        // shuffled. Smooth signal => tiny deltas => highly compressible; client
        // prefix-sums in float64 (worst-case drift measured ~0.02 m/s).
        putShuffledVelDeltas(buf, vx, timestepCount, bodyCount);
        putShuffledVelDeltas(buf, vy, timestepCount, bodyCount);
        putShuffledVelDeltas(buf, vz, timestepCount, bodyCount);

        return buf.array();
    }

    /**
     * Writes per-step deltas of {@code vals} (a flat {@code [t*B + b]} array) as
     * a byte-plane-shuffled float32 plane in (timestep, body) order. Row 0 is
     * all zeros (the per-body reference carries timestep 0). Shuffling splits
     * each float's 4 bytes into 4 contiguous runs so zstd compresses the stable
     * high-order bytes; the client reconstructs by un-shuffle + prefix sum.
     */
    private static void putShuffledStepDeltas(ByteBuffer buf, double[] vals,
                                              int timestepCount, int bodyCount) {
        int n = timestepCount * bodyCount;
        float[] plane = new float[n];                 // row 0 already 0.0f
        for (int i = 1; i < timestepCount; i++) {
            int base = i * bodyCount, prev = base - bodyCount;
            for (int b = 0; b < bodyCount; b++) {
                plane[base + b] = (float) (vals[base + b] - vals[prev + b]);
            }
        }
        putShuffledFloats(buf, plane);
    }

    /**
     * Writes velocity as a byte-plane-shuffled float32 temporal-delta plane:
     * row 0 holds the absolute velocity, rows 1..T-1 hold per-step deltas.
     * {@code vals} is the float32-cast velocity in (timestep, body) order.
     */
    private static void putShuffledVelDeltas(ByteBuffer buf, float[] vals,
                                             int timestepCount, int bodyCount) {
        int n = timestepCount * bodyCount;
        float[] plane = new float[n];
        for (int b = 0; b < bodyCount; b++) plane[b] = vals[b];   // row 0 absolute
        for (int i = 1; i < timestepCount; i++) {
            int base = i * bodyCount, prev = base - bodyCount;
            for (int b = 0; b < bodyCount; b++) {
                plane[base + b] = vals[base + b] - vals[prev + b];
            }
        }
        putShuffledFloats(buf, plane);
    }

    /**
     * Byte-plane shuffle: writes all of each float's byte 0 (n bytes), then all
     * byte 1, then byte 2, then byte 3. Byte p of value i lands at p*n + i.
     */
    private static void putShuffledFloats(ByteBuffer buf, float[] vals) {
        int n = vals.length;
        byte[] out = new byte[n * 4];
        for (int i = 0; i < n; i++) {
            int bits = Float.floatToRawIntBits(vals[i]);
            for (int p = 0; p < 4; p++) {
                out[p * n + i] = (byte) (bits >>> (8 * p));
            }
        }
        buf.put(out);
    }
}
