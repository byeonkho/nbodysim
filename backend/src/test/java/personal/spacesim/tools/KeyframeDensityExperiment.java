package personal.spacesim.tools;

import java.util.LinkedHashMap;
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
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

/**
 * Measurement tool for the post-zstd bandwidth saving of global keyframe
 * decimation, and the worst-case cubic-Hermite position reconstruction error
 * that comes with it.
 *
 * <p>The prior {@link AdaptiveSamplingExperiment} measured the <em>raw</em>
 * keyframe-count potential, but raw keyframe count overlaps heavily with what
 * zstd already compresses for free in the v3 wire format (byte-shuffle +
 * velocity-delta). This tool answers the actual question: if we globally
 * decimate the chunk keyframes by a factor D (keeping every D-th frame and
 * letting the client cubic-Hermite-interpolate the dropped frames), how many
 * <em>compressed</em> bytes does that save through the real v3 serializer +
 * zstd-3 pipeline, and what is the worst-case Euclidean position reconstruction
 * error across all bodies and all dropped frames?
 *
 * <p>Decimation is uniform-grid only (indices 0, D, 2D, ..., up to the largest
 * multiple of D that is &le; T-1). A non-grid tail index is intentionally
 * excluded because the v3 wire format assumes uniform spacing on the client
 * side; an irregular tail would require extra framing overhead that is not
 * modeled here.
 *
 * <p>Disabled by default. Run with:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=KeyframeDensityExperiment -Ddensity.experiment=true -q
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "density.experiment", matches = "true")
class KeyframeDensityExperiment {

    private static final List<String> BODIES = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
    );

    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";

    /** Decimation factors: D=1 is the baseline (no decimation). */
    private static final int[] FACTORS = {1, 2, 4, 8};

    private record Scenario(String label, String integrator, int k, int n) {}

    private static final List<Scenario> SCENARIOS = List.of(
        new Scenario("rk4   K=4",    "rk4",   4,    0),
        new Scenario("dp853 N=5000", "dp853",  1, 5000)
    );

    @Autowired private SimulationFactory simulationFactory;
    @Autowired private BinaryResponseSerializer binaryResponseSerializer;
    @Autowired private ZstdCompressor zstdCompressor;

    // Flat per-chunk arrays extracted from a ChunkResult.
    // px/py/pz: double[T*B] in (t-major, body-minor) order — index = t*B + b.
    // vx/vy/vz: same shape, float32-cast velocity values (m/s).
    // ts: per-timestep epoch millis (UTC), length T.
    private record ChunkArrays(
        int t, int b,
        double[] px, double[] py, double[] pz,
        float[] vx, float[] vy, float[] vz,
        long[] ts
    ) {}

    @Test
    void measure() {
        AbsoluteDate startDate =
            new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());

        for (Scenario s : SCENARIOS) {
            System.out.println();
            System.out.println("################  " + s.label + "  ################");

            // --- build and run the simulation ---
            String sessionId = "density-exp-" + s.integrator
                + (s.n > 0 ? "-N" + s.n : "-K" + s.k);
            Simulation sim = simulationFactory.createSimulation(
                sessionId,
                BODIES, FRAME, s.integrator, startDate, TIME_STEP_UNIT,
                s.k, s.n
            );

            ChunkResult full = sim.run();

            // Build muByName from the simulation's body list (same pattern as
            // ChunkSizeBenchmark — order matches BODIES).
            LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
            for (CelestialBodyWrapper w : sim.getCelestialBodies()) {
                muByName.put(w.getName(), w.getMu());
            }

            // Extract full-resolution flat arrays.
            ChunkArrays arr = extract(full);
            int T = arr.t;
            int B = arr.b;
            // Uniform time gap in seconds between consecutive keyframes.
            double gapSec = (arr.ts[1] - arr.ts[0]) / 1000.0;

            System.out.printf("T=%d timesteps, B=%d bodies, gap=%.1f s%n", T, B, gapSec);
            System.out.printf("Bodies: %s%n", BODIES);
            System.out.println();

            // D=1 compressed size is the baseline for percent comparisons.
            int baselineCompressedBytes = -1;

            // Print table header.
            System.out.printf("  %-4s %16s %14s %12s %22s %16s%n",
                "D", "keptTimesteps", "compressedKB", "%baseline",
                "worstHermiteErr(m)", "worstBody");
            System.out.println("  " + "-".repeat(88));

            for (int D : FACTORS) {
                // --- build decimated ChunkResult ---
                //
                // Kept indices: 0, D, 2D, ..., lastKept, where
                //   lastKept = floor((T-1) / D) * D.
                //
                // We iterate the full snapshots map in insertion order
                // (guaranteed LinkedHashMap per ChunkResult's Javadoc) and
                // copy every D-th entry. A plain counter tracks the timestep
                // index; we copy when index % D == 0 AND index <= lastKept.
                int lastKept = ((T - 1) / D) * D;

                LinkedHashMap<AbsoluteDate, List<CelestialBodySnapshot>> decSnaps =
                    new LinkedHashMap<>();
                LinkedHashMap<AbsoluteDate, Double> decDeltaE = new LinkedHashMap<>();

                int tIdx = 0;
                for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> e
                        : full.snapshots().entrySet()) {
                    if (tIdx % D == 0 && tIdx <= lastKept) {
                        decSnaps.put(e.getKey(), e.getValue());
                        // deltaERelative shares the same keys by construction.
                        Double dE = full.deltaERelative().get(e.getKey());
                        decDeltaE.put(e.getKey(), dE);
                    }
                    tIdx++;
                }

                ChunkResult decimated = new ChunkResult(decSnaps, decDeltaE, full.telemetry());

                // --- compressed size ---
                byte[] raw = binaryResponseSerializer.serialize(decimated, muByName);
                byte[] compressed = zstdCompressor.compress(raw);
                int compressedBytes = compressed.length;
                int keptTimesteps = decSnaps.size();

                if (D == 1) {
                    baselineCompressedBytes = compressedBytes;
                }

                double compressedKB = compressedBytes / 1024.0;
                double pctBaseline = (double) compressedBytes / baselineCompressedBytes * 100.0;

                // --- worst-case Hermite reconstruction error ---
                // For D=1 there are no dropped indices, so error is exactly 0.
                double worstErr = 0.0;
                String worstBody = "n/a";

                if (D > 1) {
                    // For each dropped index i (1..lastKept where i % D != 0),
                    // bracket with a = (i/D)*D and c = a+D.
                    // Both a and c are kept indices by construction:
                    //   - a is a multiple of D with a <= lastKept.
                    //   - c = a+D; since i is not a multiple of D and i <= lastKept,
                    //     a = floor(i/D)*D < i <= lastKept, so a < lastKept, so
                    //     c = a+D <= lastKept (because a+D is the next multiple of D
                    //     after a, and a < lastKept means a+D <= lastKept).
                    // Therefore c never exceeds lastKept.
                    for (int bi = 0; bi < B; bi++) {
                        for (int i = 1; i <= lastKept; i++) {
                            if (i % D == 0) {
                                // kept keyframe — no reconstruction needed
                                continue;
                            }
                            int a = (i / D) * D;
                            int c = a + D;  // c <= lastKept (see proof above)

                            // Interval time span (seconds) and local parameter u in (0,1).
                            double h = (c - a) * gapSec;
                            double u = (double) (i - a) / (double) (c - a);

                            // Hermite basis values.
                            double u2 = u * u;
                            double u3 = u2 * u;
                            double h00 =  2.0 * u3 - 3.0 * u2 + 1.0;
                            double h10 =        u3 - 2.0 * u2 + u;
                            double h01 = -2.0 * u3 + 3.0 * u2;
                            double h11 =        u3 -       u2;

                            // Flat array indices.
                            int idxA = a * B + bi;
                            int idxC = c * B + bi;
                            int idxI = i * B + bi;

                            // Widen float velocities to double before the math.
                            double vaX = arr.vx[idxA], vaY = arr.vy[idxA], vaZ = arr.vz[idxA];
                            double vcX = arr.vx[idxC], vcY = arr.vy[idxC], vcZ = arr.vz[idxC];

                            // Hermite reconstruction (component-wise).
                            // h*v has units seconds * (m/s) = m, matching position terms.
                            double rX = h00 * arr.px[idxA] + h10 * h * vaX
                                      + h01 * arr.px[idxC] + h11 * h * vcX;
                            double rY = h00 * arr.py[idxA] + h10 * h * vaY
                                      + h01 * arr.py[idxC] + h11 * h * vcY;
                            double rZ = h00 * arr.pz[idxA] + h10 * h * vaZ
                                      + h01 * arr.pz[idxC] + h11 * h * vcZ;

                            // Euclidean error vs true full-res position.
                            double dX = rX - arr.px[idxI];
                            double dY = rY - arr.py[idxI];
                            double dZ = rZ - arr.pz[idxI];
                            double err = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

                            if (err > worstErr) {
                                worstErr = err;
                                worstBody = BODIES.get(bi);
                            }
                        }
                    }
                }

                System.out.printf("  %-4d %16d %14.2f %12.1f %22.3e %16s%n",
                    D, keptTimesteps, compressedKB, pctBaseline, worstErr, worstBody);
            }

            System.out.println();
        }

        System.out.println();
        System.out.println("Decimation D means the client receives 1/D of the keyframes and "
            + "cubic-Hermite-interpolates the rest. compressedKB is the REAL v3-serialized "
            + "+ zstd-3 size. worstHermiteErr is the largest position reconstruction error "
            + "across all bodies; at the real render scale (divide by 1e8) ~1e6 m = "
            + "~0.01 world units = sub-pixel. This sizes the actual post-compression win of "
            + "coarser global keyframe density vs the accuracy cost. Trails / integrator-residual "
            + "display / reality-drift overlay are separate consumers of keyframe density not "
            + "modeled here.");
        System.out.println();
    }

    // ---- array extraction (mirrors AdaptiveSamplingExperiment) ----

    private ChunkArrays extract(ChunkResult chunk) {
        Map<AbsoluteDate, List<CelestialBodySnapshot>> snaps = chunk.snapshots();
        int t = snaps.size();
        int b = snaps.values().iterator().next().size();
        double[] px = new double[t * b], py = new double[t * b], pz = new double[t * b];
        float[] vx = new float[t * b], vy = new float[t * b], vz = new float[t * b];
        long[] ts = new long[t];
        int ti = 0;
        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> e : snaps.entrySet()) {
            ts[ti] = e.getKey().toDate(TimeScalesFactory.getUTC()).getTime();
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
        return new ChunkArrays(t, b, px, py, pz, vx, vy, vz, ts);
    }
}
