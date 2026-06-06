package personal.spacesim.tools;

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

/**
 * Measurement tool for per-body Hermite-decimation headroom — the raw
 * keyframe-count saving that per-body adaptive sampling could yield.
 *
 * <p>The chunk wire currently sends every body the same number of
 * time-uniform keyframes. But bodies move at very different rates: Neptune
 * barely moves over a chunk while Mercury or Io move a lot. The client
 * reconstructs positions between keyframes using cubic Hermite interpolation,
 * which uses both the position and the velocity at each kept keyframe. That
 * means slow/smooth bodies could be sent far fewer keyframes with no visible
 * error, because the Hermite curve closely tracks the true trajectory even
 * when the kept samples are far apart.
 *
 * <p>This tool quantifies, per body, how aggressively each body's track can
 * be decimated (i.e. how many intermediate keyframes can be dropped) before
 * Hermite reconstruction error exceeds a tolerance. The result is the raw
 * keyframe-count potential of adaptive sampling — how much smaller the wire
 * could be if each body sent only as many keyframes as its motion demands.
 *
 * <p>Disabled by default. Run with:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=AdaptiveSamplingExperiment -Dadaptive.experiment=true -q
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "adaptive.experiment", matches = "true")
class AdaptiveSamplingExperiment {

    private static final List<String> BODIES = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
    );

    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";

    // Decimation factors to test: keep every K-th keyframe.
    private static final int[] FACTORS = {2, 4, 8, 16, 32, 64};

    // Tolerance thresholds in metres: 1 km, 100 km, 1000 km, 10000 km.
    private static final double[] TOLERANCES = {1e3, 1e5, 1e6, 1e7};

    private record Scenario(String label, String integrator, int k, int n) {}

    private static final List<Scenario> SCENARIOS = List.of(
        new Scenario("rk4   K=4", "rk4", 4, 0),
        new Scenario("dp853 N=5000", "dp853", 1, 5000)
    );

    @Autowired private SimulationFactory simulationFactory;

    // Flat per-chunk arrays extracted from a ChunkResult.
    // px/py/pz: double[T*B] in (t major, body minor) order — i.e. index = t*B + b.
    // vx/vy/vz: same shape, float32-cast velocity values (m/s).
    // ts: per-timestep epoch millis (UTC).
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

            Simulation sim = simulationFactory.createSimulation(
                "adaptive-exp-" + s.integrator + (s.n > 0 ? "-N" + s.n : "-K" + s.k),
                BODIES, FRAME, s.integrator, startDate, TIME_STEP_UNIT, s.k, s.n);

            ChunkResult chunk = sim.run();
            ChunkArrays arr = extract(chunk);

            // Uniform time gap in seconds between consecutive keyframes.
            // ts values are Unix millis (UTC); gap = diff of first two timesteps / 1000.
            double gapSec = (arr.ts[1] - arr.ts[0]) / 1000.0;

            System.out.printf("T=%d timesteps, B=%d bodies, gap=%.1f s%n", arr.t, arr.b, gapSec);
            System.out.printf("Bodies: %s%n", BODIES);
            System.out.println();

            // maxError[body][factorIndex] = worst-case Euclidean reconstruction
            // error (metres) over all interior keyframes when using decimation
            // factor FACTORS[factorIndex].
            double[][] maxError = computeMaxErrors(arr, gapSec);

            // Representative-tolerance table (tol = 1e6 m = 1000 km).
            int tolIdx1000km = 2;      // TOLERANCES[2] = 1e6
            double tol1000km = TOLERANCES[tolIdx1000km];
            int factorIdx2 = 0;        // FACTORS[0] = 2
            int factorIdx8 = 2;        // FACTORS[2] = 8

            System.out.printf("  Per-body decimation headroom at tol=%.0e m (1000 km):%n", tol1000km);
            System.out.printf("  %-12s %20s %20s %12s%n",
                "body", "maxErr@K2 (m)", "maxErr@K8 (m)", "Kbest(1000km)");
            System.out.println("  " + "-".repeat(68));

            for (int bi = 0; bi < arr.b; bi++) {
                int kbest = bestFactor(maxError[bi], tol1000km);
                System.out.printf("  %-12s %20.3e %20.3e %12d%n",
                    BODIES.get(bi),
                    maxError[bi][factorIdx2],
                    maxError[bi][factorIdx8],
                    kbest);
            }

            System.out.println();

            // Aggregate-potential table across all tolerances.
            System.out.println("  Aggregate keyframe-saving potential:");
            System.out.printf("  %-14s %20s %12s%n",
                "tol (m)", "adaptiveFraction", "saving%");
            System.out.println("  " + "-".repeat(50));

            for (double tol : TOLERANCES) {
                double fractionSum = 0.0;
                for (int bi = 0; bi < arr.b; bi++) {
                    int kbest = bestFactor(maxError[bi], tol);
                    fractionSum += 1.0 / kbest;
                }
                double adaptiveFraction = fractionSum / arr.b;
                double savingPct = (1.0 - adaptiveFraction) * 100.0;
                System.out.printf("  %-14.0e %20.4f %12.1f%%%n",
                    tol, adaptiveFraction, savingPct);
            }

            System.out.println();
        }

        System.out.println();
        System.out.println("NOTE: this is the RAW keyframe-count potential. The current wire already "
            + "delta-encodes + byte-shuffles + zstds, which compresses slow-body redundancy, so the "
            + "post-compression saving is smaller than the raw keyframe drop shown here. This measures "
            + "whether the lever is large enough to justify the structural complexity of per-body "
            + "variable sampling.");
    }

    /**
     * Computes maxError[b][fi] = worst-case Euclidean Hermite reconstruction
     * error (metres) for body {@code b} at decimation factor {@code FACTORS[fi]},
     * over all interior (non-kept) keyframe indices.
     *
     * <p>For each decimation factor K, the kept indices are
     * {@code 0, K, 2K, ...} plus the last index {@code T-1}. Every index not
     * in that set is an "interior" point that must be reconstructed from its
     * two bracketing kept keyframes using cubic Hermite interpolation.
     *
     * <p>Hermite basis (s = local parameter in [0,1]):
     * <pre>
     *   h00 = 2s³ - 3s² + 1
     *   h10 = s³  - 2s² + s
     *   h01 = -2s³ + 3s²
     *   h11 = s³  - s²
     *   recon = h00*p_a + h10*h*v_a + h01*p_c + h11*h*v_c
     * </pre>
     * where {@code h} (lowercase) is the time span of the interval in seconds
     * and {@code v_a}, {@code v_c} are velocities in m/s. The {@code h*v}
     * terms have units m, matching {@code p}.
     */
    private double[][] computeMaxErrors(ChunkArrays arr, double gapSec) {
        int T = arr.t;
        int B = arr.b;
        double[][] maxError = new double[B][FACTORS.length];

        for (int fi = 0; fi < FACTORS.length; fi++) {
            int K = FACTORS[fi];

            for (int bi = 0; bi < B; bi++) {
                double bodyMaxErr = 0.0;

                // Walk every interior index (indices not in the kept set).
                // Kept indices: 0, K, 2K, ..., and always T-1.
                // For an interior index i, the bracketing kept pair is:
                //   a = floor(i / K) * K       (largest kept index <= i)
                //   c = a + K                  (smallest kept index >= i)
                // with c clamped to T-1 if a+K >= T (handles the tail segment
                // where the last kept is T-1, not necessarily a multiple of K).
                for (int i = 1; i < T; i++) {
                    int a = (i / K) * K;
                    if (a == i) {
                        // i is itself a kept keyframe; skip (no reconstruction needed).
                        continue;
                    }
                    // a < i by construction here.
                    int c = a + K;
                    if (c >= T) {
                        // Tail segment: bracket is [a, T-1].
                        c = T - 1;
                    }
                    if (c == i) {
                        // i coincides with a kept keyframe at the tail; skip.
                        continue;
                    }

                    // Interval time span (seconds) and local parameter s in (0,1).
                    double h = (c - a) * gapSec;    // h in seconds
                    double s = (double) (i - a) / (double) (c - a);

                    // Hermite basis values.
                    double s2 = s * s;
                    double s3 = s2 * s;
                    double h00 =  2.0 * s3 - 3.0 * s2 + 1.0;
                    double h10 =        s3 - 2.0 * s2 + s;
                    double h01 = -2.0 * s3 + 3.0 * s2;
                    double h11 =        s3 -       s2;

                    // Flat array indices for the two bracket endpoints.
                    int idxA = a * B + bi;
                    int idxC = c * B + bi;
                    int idxI = i * B + bi;

                    // Widen float velocities to double before entering the math.
                    double vaX = arr.vx[idxA], vaY = arr.vy[idxA], vaZ = arr.vz[idxA];
                    double vcX = arr.vx[idxC], vcY = arr.vy[idxC], vcZ = arr.vz[idxC];

                    // Hermite reconstruction (component-wise). h*v has units
                    // seconds * (m/s) = m, matching the position terms.
                    double rX = h00 * arr.px[idxA] + h10 * h * vaX
                              + h01 * arr.px[idxC] + h11 * h * vcX;
                    double rY = h00 * arr.py[idxA] + h10 * h * vaY
                              + h01 * arr.py[idxC] + h11 * h * vcY;
                    double rZ = h00 * arr.pz[idxA] + h10 * h * vaZ
                              + h01 * arr.pz[idxC] + h11 * h * vcZ;

                    // Euclidean error between reconstructed and true position.
                    double dX = rX - arr.px[idxI];
                    double dY = rY - arr.py[idxI];
                    double dZ = rZ - arr.pz[idxI];
                    double err = Math.sqrt(dX * dX + dY * dY + dZ * dZ);

                    if (err > bodyMaxErr) bodyMaxErr = err;
                }

                maxError[bi][fi] = bodyMaxErr;
            }
        }

        return maxError;
    }

    /**
     * Returns the largest decimation factor K from {@link #FACTORS} whose
     * max reconstruction error does not exceed {@code tol} metres, or 1 if
     * even the smallest factor (K=2) exceeds the tolerance.
     */
    private int bestFactor(double[] bodyErrors, double tol) {
        int best = 1;
        for (int fi = 0; fi < FACTORS.length; fi++) {
            if (bodyErrors[fi] <= tol) {
                best = FACTORS[fi];
            }
        }
        return best;
    }

    // ---- extraction (mirrors PositionEncodingExperiment) ----

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
