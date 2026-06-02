package personal.spacesim.tools;

import com.github.luben.zstd.Zstd;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

/**
 * Bandwidth audit spike — compares candidate position-encoding strategies
 * against the current wire format on REAL integrator output, isolating the
 * compression question from network/runtime noise.
 *
 * <p>Baseline (ChunkSizeBenchmark) showed zstd is a near-no-op on this
 * payload (~1.17x). This harness tests whether re-laying-out / delta-encoding
 * the bytes lets zstd actually work, and what the precision cost is for the
 * lossy variants.
 *
 * <p>Each encoder produces a COMPLETE body-section byte[] (header is
 * identical across all variants and excluded, since it's a tiny constant and
 * the same for every strategy). Position handling + field layout is what
 * differs. Velocity stays float32 throughout (load-bearing as the Hermite
 * tangent; not the target). Reported sizes are body-section only, compressed
 * at zstd level 3 (production default) and 19 (affordable since compression
 * runs off the request critical path on the precompute thread).
 *
 * <p>Disabled by default. Run:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=PositionEncodingExperiment -Dpos.experiment=true -q
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "pos.experiment", matches = "true")
class PositionEncodingExperiment {

    private static final List<String> BODIES = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    );
    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";

    private record Scenario(String label, String integrator, int k, int n) {}

    private static final List<Scenario> SCENARIOS = List.of(
        new Scenario("rk4   K=4   (default)",   "rk4",   4,  0),
        new Scenario("dp853 N=5000  (default)", "dp853", 1,  5000),
        new Scenario("dp853 N=15000 (highest)", "dp853", 1, 15000)
    );

    @Autowired private SimulationFactory simulationFactory;

    // Flat per-chunk arrays extracted from a ChunkResult.
    // px/py/pz: double[T*B] in (t major, body minor) order.
    // vx/vy/vz: same shape, the float32-cast velocity values.
    private record ChunkArrays(
        int t, int b,
        double[] px, double[] py, double[] pz,
        float[] vx, float[] vy, float[] vz,
        long[] ts, float[] dE
    ) {}

    @Test
    void measure() {
        AbsoluteDate startDate =
            new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());

        System.out.println();
        System.out.println("Position-encoding experiment — " + BODIES.size()
            + " bodies, " + TIME_STEP_UNIT + " step, ICRF. Body-section bytes only.");
        System.out.println("All sizes in KB. %base = vs baseline zstd-3 (the production number).");
        System.out.println();

        for (Scenario s : SCENARIOS) {
            Simulation sim = simulationFactory.createSimulation(
                "pos-exp-" + s.integrator + "-" + (s.n > 0 ? "N" + s.n : "K" + s.k),
                BODIES, FRAME, s.integrator, startDate, TIME_STEP_UNIT, s.k, s.n);
            ChunkResult chunk = sim.run();
            ChunkArrays arr = extract(chunk);

            System.out.println("== " + s.label + "  (T=" + arr.t + ", B=" + arr.b + ") ==");
            System.out.printf("  %-34s %10s %10s %10s %12s%n",
                "encoder", "raw KB", "zstd3 KB", "zstd19 KB", "max err (m)");
            System.out.println("  " + "-".repeat(80));

            byte[] base = encodeBaseline(arr);
            long baseZ3 = Zstd.compress(base, 3).length;

            report("baseline (interleaved f64 pos)", base, 0.0, baseZ3);
            report("SoA (planar f64 pos)", encodeSoA(arr), 0.0, baseZ3);
            report("SoA + byte-shuffle f64 pos", encodeSoAShuffle(arr), 0.0, baseZ3);
            report("SoA temporal-delta f64 pos", encodeTemporalDeltaF64(arr), 0.0, baseZ3);
            report("SoA + shuffle temporal-delta f64", encodeTemporalDeltaF64Shuffle(arr), 0.0, baseZ3);
            reportLossy("SoA f32 delta-from-ref pos", encodeF32DeltaRef(arr), errF32DeltaRef(arr), baseZ3);
            reportLossy("SoA f32 temporal-delta pos", encodeF32TemporalDelta(arr), errF32TemporalDelta(arr), baseZ3);

            System.out.println();
        }

        System.out.println("Notes:");
        System.out.println("  - Velocity is float32 in every variant (Hermite tangent; not the target).");
        System.out.println("  - Position is ~2/3 of the body-section; these deltas scale ~linearly with body count.");
        System.out.println("  - 'max err' is max abs position-component error vs the f64 baseline, over all T*B*3.");
        System.out.println();
    }

    private void report(String name, byte[] raw, double maxErr, long baseZ3) {
        long z3 = Zstd.compress(raw, 3).length;
        long z19 = Zstd.compress(raw, 19).length;
        System.out.printf("  %-34s %10.1f %10.1f %10.1f %12s   (%.0f%% base)%n",
            name, raw.length / 1024.0, z3 / 1024.0, z19 / 1024.0,
            "lossless", 100.0 * z3 / baseZ3);
    }

    private void reportLossy(String name, byte[] raw, double maxErr, long baseZ3) {
        long z3 = Zstd.compress(raw, 3).length;
        long z19 = Zstd.compress(raw, 19).length;
        System.out.printf("  %-34s %10.1f %10.1f %10.1f %12.1f   (%.0f%% base)%n",
            name, raw.length / 1024.0, z3 / 1024.0, z19 / 1024.0,
            maxErr, 100.0 * z3 / baseZ3);
    }

    // ---- extraction ----

    private ChunkArrays extract(ChunkResult chunk) {
        Map<AbsoluteDate, List<CelestialBodySnapshot>> snaps = chunk.snapshots();
        int t = snaps.size();
        int b = snaps.values().iterator().next().size();
        double[] px = new double[t * b], py = new double[t * b], pz = new double[t * b];
        float[] vx = new float[t * b], vy = new float[t * b], vz = new float[t * b];
        long[] ts = new long[t];
        float[] dE = new float[t];
        Map<AbsoluteDate, Double> deltaE = chunk.deltaERelative();
        int ti = 0;
        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> e : snaps.entrySet()) {
            ts[ti] = e.getKey().toDate(TimeScalesFactory.getUTC()).getTime();
            Double d = deltaE != null ? deltaE.get(e.getKey()) : null;
            dE[ti] = d != null ? d.floatValue() : 0f;
            List<CelestialBodySnapshot> row = e.getValue();
            for (int bi = 0; bi < b; bi++) {
                int idx = ti * b + bi;
                px[idx] = row.get(bi).position().getX();
                py[idx] = row.get(bi).position().getY();
                pz[idx] = row.get(bi).position().getZ();
                vx[idx] = (float) row.get(bi).velocity().getX();
                vy[idx] = (float) row.get(bi).velocity().getY();
                vz[idx] = (float) row.get(bi).velocity().getZ();
            }
            ti++;
        }
        return new ChunkArrays(t, b, px, py, pz, vx, vy, vz, ts, dE);
    }

    // ---- shared helpers ----

    // Per-timestep scalars (timestamp + deltaE) written planar, identical in
    // every SoA variant. Returned as the leading bytes so layouts are
    // comparable apples-to-apples.
    private void putScalars(ByteBuffer buf, ChunkArrays a) {
        for (int i = 0; i < a.t; i++) buf.putLong(a.ts[i]);
        for (int i = 0; i < a.t; i++) buf.putFloat(a.dE[i]);
    }

    private void putVelSoA(ByteBuffer buf, ChunkArrays a) {
        for (float v : a.vx) buf.putFloat(v);
        for (float v : a.vy) buf.putFloat(v);
        for (float v : a.vz) buf.putFloat(v);
    }

    private int scalarBytes(ChunkArrays a) { return a.t * 8 + a.t * 4; }
    private int velBytes(ChunkArrays a) { return a.t * a.b * 3 * 4; }

    // Byte-plane shuffle: split an array of doubles into 8 planes (all byte0s,
    // then all byte1s, ...). Structured high-order bytes form long runs.
    private byte[] shuffleDoubles(double[] vals) {
        int n = vals.length;
        byte[] out = new byte[n * 8];
        for (int i = 0; i < n; i++) {
            long bits = Double.doubleToRawLongBits(vals[i]);
            for (int p = 0; p < 8; p++) {
                out[p * n + i] = (byte) (bits >>> (8 * p));
            }
        }
        return out;
    }

    // ---- encoders ----

    // E0: current production layout — interleaved per timestep.
    private byte[] encodeBaseline(ChunkArrays a) {
        int perTs = 8 + 4 + a.b * (3 * 8 + 3 * 4);
        ByteBuffer buf = ByteBuffer.allocate(a.t * perTs).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < a.t; i++) {
            buf.putLong(a.ts[i]);
            buf.putFloat(a.dE[i]);
            for (int bi = 0; bi < a.b; bi++) {
                int idx = i * a.b + bi;
                buf.putDouble(a.px[idx]).putDouble(a.py[idx]).putDouble(a.pz[idx]);
                buf.putFloat(a.vx[idx]).putFloat(a.vy[idx]).putFloat(a.vz[idx]);
            }
        }
        return buf.array();
    }

    // E1: structure-of-arrays. Same values/precision, grouped by field.
    private byte[] encodeSoA(ChunkArrays a) {
        int size = scalarBytes(a) + a.t * a.b * 3 * 8 + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        for (double v : a.px) buf.putDouble(v);
        for (double v : a.py) buf.putDouble(v);
        for (double v : a.pz) buf.putDouble(v);
        putVelSoA(buf, a);
        return buf.array();
    }

    // E2: SoA + byte-plane shuffle on the f64 position planes.
    private byte[] encodeSoAShuffle(ChunkArrays a) {
        byte[] sx = shuffleDoubles(a.px), sy = shuffleDoubles(a.py), sz = shuffleDoubles(a.pz);
        int size = scalarBytes(a) + sx.length + sy.length + sz.length + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        buf.put(sx).put(sy).put(sz);
        putVelSoA(buf, a);
        return buf.array();
    }

    // Temporal delta in f64: store [t0 absolute, then (t - (t-1)) per body].
    private double[] temporalDelta(double[] vals, int t, int b) {
        double[] out = new double[vals.length];
        for (int bi = 0; bi < b; bi++) out[bi] = vals[bi];            // row 0 absolute
        for (int i = 1; i < t; i++) {
            for (int bi = 0; bi < b; bi++) {
                int idx = i * b + bi;
                out[idx] = vals[idx] - vals[idx - b];
            }
        }
        return out;
    }

    // E3: SoA temporal-delta f64 (lossless).
    private byte[] encodeTemporalDeltaF64(ChunkArrays a) {
        double[] dx = temporalDelta(a.px, a.t, a.b);
        double[] dy = temporalDelta(a.py, a.t, a.b);
        double[] dz = temporalDelta(a.pz, a.t, a.b);
        int size = scalarBytes(a) + a.t * a.b * 3 * 8 + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        for (double v : dx) buf.putDouble(v);
        for (double v : dy) buf.putDouble(v);
        for (double v : dz) buf.putDouble(v);
        putVelSoA(buf, a);
        return buf.array();
    }

    // E4: SoA temporal-delta f64 + byte-shuffle (lossless).
    private byte[] encodeTemporalDeltaF64Shuffle(ChunkArrays a) {
        byte[] sx = shuffleDoubles(temporalDelta(a.px, a.t, a.b));
        byte[] sy = shuffleDoubles(temporalDelta(a.py, a.t, a.b));
        byte[] sz = shuffleDoubles(temporalDelta(a.pz, a.t, a.b));
        int size = scalarBytes(a) + sx.length + sy.length + sz.length + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        buf.put(sx).put(sy).put(sz);
        putVelSoA(buf, a);
        return buf.array();
    }

    // E5: per-body f64 reference (chunk-start) + float32 offsets. 24->12 B/body.
    private byte[] encodeF32DeltaRef(ChunkArrays a) {
        int size = scalarBytes(a)
            + a.b * 3 * 8                       // per-body f64 reference (px,py,pz)
            + a.t * a.b * 3 * 4                 // f32 offsets
            + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        for (int bi = 0; bi < a.b; bi++) {
            buf.putDouble(a.px[bi]).putDouble(a.py[bi]).putDouble(a.pz[bi]);
        }
        putF32OffsetsFromRef(buf, a.px, a.t, a.b);
        putF32OffsetsFromRef(buf, a.py, a.t, a.b);
        putF32OffsetsFromRef(buf, a.pz, a.t, a.b);
        putVelSoA(buf, a);
        return buf.array();
    }

    private void putF32OffsetsFromRef(ByteBuffer buf, double[] vals, int t, int b) {
        for (int i = 0; i < t; i++) {
            for (int bi = 0; bi < b; bi++) {
                buf.putFloat((float) (vals[i * b + bi] - vals[bi]));
            }
        }
    }

    private double errF32DeltaRef(ChunkArrays a) {
        return Math.max(Math.max(
            errRef(a.px, a.t, a.b), errRef(a.py, a.t, a.b)), errRef(a.pz, a.t, a.b));
    }

    private double errRef(double[] vals, int t, int b) {
        double maxErr = 0;
        for (int i = 0; i < t; i++) {
            for (int bi = 0; bi < b; bi++) {
                double ref = vals[bi];
                double recon = ref + (double) (float) (vals[i * b + bi] - ref);
                maxErr = Math.max(maxErr, Math.abs(recon - vals[i * b + bi]));
            }
        }
        return maxErr;
    }

    // E6: per-body f64 reference (chunk-start) + float32 PER-STEP deltas.
    // Tiny deltas store near-exactly in f32; reconstruction is a prefix sum,
    // so f32 rounding accumulates over T steps — measured by errF32TemporalDelta.
    private byte[] encodeF32TemporalDelta(ChunkArrays a) {
        int size = scalarBytes(a)
            + a.b * 3 * 8
            + a.t * a.b * 3 * 4
            + velBytes(a);
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        putScalars(buf, a);
        for (int bi = 0; bi < a.b; bi++) {
            buf.putDouble(a.px[bi]).putDouble(a.py[bi]).putDouble(a.pz[bi]);
        }
        putF32StepDeltas(buf, a.px, a.t, a.b);
        putF32StepDeltas(buf, a.py, a.t, a.b);
        putF32StepDeltas(buf, a.pz, a.t, a.b);
        putVelSoA(buf, a);
        return buf.array();
    }

    private void putF32StepDeltas(ByteBuffer buf, double[] vals, int t, int b) {
        // Row 0 offsets are zero (ref == row 0); rows 1..T-1 are step deltas.
        for (int bi = 0; bi < b; bi++) buf.putFloat(0f);
        for (int i = 1; i < t; i++) {
            for (int bi = 0; bi < b; bi++) {
                buf.putFloat((float) (vals[i * b + bi] - vals[(i - 1) * b + bi]));
            }
        }
    }

    private double errF32TemporalDelta(ChunkArrays a) {
        return Math.max(Math.max(
            errStep(a.px, a.t, a.b), errStep(a.py, a.t, a.b)), errStep(a.pz, a.t, a.b));
    }

    private double errStep(double[] vals, int t, int b) {
        // Reconstruct via prefix sum of f32-rounded step deltas, mirroring the
        // client decode path, and measure worst-case accumulated drift.
        double maxErr = 0;
        double[] recon = new double[b];
        for (int bi = 0; bi < b; bi++) recon[bi] = vals[bi];
        for (int i = 1; i < t; i++) {
            for (int bi = 0; bi < b; bi++) {
                float d = (float) (vals[i * b + bi] - vals[(i - 1) * b + bi]);
                recon[bi] += d;
                maxErr = Math.max(maxErr, Math.abs(recon[bi] - vals[i * b + bi]));
            }
        }
        return maxErr;
    }
}
