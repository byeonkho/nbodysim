package personal.spacesim.tools;

import java.util.LinkedHashMap;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.constants.FidelityBucket;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

/**
 * Measures the exact before/after chunk size of lowering the per-integrator
 * landing default by one fidelity bucket (the #3 "coarser default density"
 * experiment). Runs the real serialize → zstd pipeline at the v3 wire format,
 * so the numbers are the true wire cost.
 *
 * <p>Pairs measured (current default → one bucket coarser):
 * <ul>
 *   <li>RK4: MEDIUM (K=5) → MED_LOW (K=10) — a clean 2x fewer keyframes.</li>
 *   <li>DP853: MED_LOW (N=5000) → LOW (N=3000) — ~1.67x fewer (DP853's buckets
 *       bottom out at N=3000).</li>
 * </ul>
 *
 * <p>Accuracy of the coarser setting is characterised separately by
 * KeyframeDensityExperiment (sub-km worst-case Hermite error at 2x) and by the
 * in-app visual check; this tool reports size only.
 *
 * <p>Disabled by default. Run:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=BucketDefaultBenchmark -Dbucket.benchmark=true -q
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "bucket.benchmark", matches = "true")
class BucketDefaultBenchmark {

    // First-run default selection (Sun + 8 planets + Earth's Moon).
    private static final List<String> BODIES_DEFAULT = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    );

    // Full opt-in catalog (planets + Pluto + major moons + dwarf/minor bodies);
    // the heavy case where bandwidth matters most. Needs the disk Horizons cache.
    private static final List<String> BODIES_FULL = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
        "Phobos", "Deimos",
        "Io", "Europa", "Ganymede", "Callisto",
        "Mimas", "Enceladus", "Tethys", "Dione", "Rhea", "Titan", "Iapetus",
        "Ariel", "Umbriel", "Titania", "Oberon", "Miranda",
        "Triton", "Nereid",
        "Ceres", "Vesta", "Pallas", "Hygiea", "Eros", "Apophis", "Bennu", "Ryugu"
    );

    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";

    @Autowired private SimulationFactory simulationFactory;
    @Autowired private BinaryResponseSerializer binaryResponseSerializer;
    @Autowired private ZstdCompressor zstdCompressor;

    private record Variant(String label, String integrator, FidelityBucket bucket, boolean isCurrentDefault) {}

    @Test
    void measure() {
        AbsoluteDate startDate =
            new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());

        List<Variant> variants = List.of(
            new Variant("RK4   MEDIUM  K=5   (current default)", "rk4", FidelityBucket.MEDIUM, true),
            new Variant("RK4   MED_LOW K=10  (proposed)",        "rk4", FidelityBucket.MED_LOW, false),
            new Variant("DP853 MED_LOW N=5000 (current default)","dp853", FidelityBucket.MED_LOW, true),
            new Variant("DP853 LOW     N=3000 (proposed)",       "dp853", FidelityBucket.LOW, false)
        );

        measureBodySet("DEFAULT (10 bodies)", BODIES_DEFAULT, startDate, variants);
        try {
            measureBodySet("FULL (39 bodies, opt-in)", BODIES_FULL, startDate, variants);
        } catch (Exception e) {
            System.out.println("  (FULL catalog skipped — likely cold Horizons cache: " + e.getMessage() + ")");
        }
    }

    private void measureBodySet(String label, List<String> bodies,
                                AbsoluteDate startDate, List<Variant> variants) {
        System.out.println();
        System.out.println("################  " + label + "  ################");
        System.out.printf("  %-40s %10s %14s %12s%n",
            "variant", "keyframes", "compressedKB", "% default");
        System.out.println("  " + "-".repeat(80));

        // Track the current-default compressed size per integrator for the % column.
        long rk4DefaultBytes = -1, dp853DefaultBytes = -1;

        for (Variant v : variants) {
            int k = v.bucket().keyframesPerKept();
            int n = v.bucket().targetSnapshotsPerChunk();
            Simulation sim = simulationFactory.createSimulation(
                "bucket-" + label.hashCode() + "-" + v.integrator() + "-" + v.bucket().wireName(),
                bodies, FRAME, v.integrator(), startDate, TIME_STEP_UNIT, k, n);
            ChunkResult chunk = sim.run();

            LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
            for (CelestialBodyWrapper w : sim.getCelestialBodies()) {
                muByName.put(w.getName(), w.getMu());
            }
            byte[] raw = binaryResponseSerializer.serialize(chunk, muByName);
            byte[] compressed = zstdCompressor.compress(raw);
            int keyframes = chunk.snapshots().size();

            long defaultBytes;
            if (v.integrator().equals("rk4")) {
                if (v.isCurrentDefault()) rk4DefaultBytes = compressed.length;
                defaultBytes = rk4DefaultBytes;
            } else {
                if (v.isCurrentDefault()) dp853DefaultBytes = compressed.length;
                defaultBytes = dp853DefaultBytes;
            }
            double pct = defaultBytes > 0 ? 100.0 * compressed.length / defaultBytes : 100.0;

            System.out.printf("  %-40s %10d %14.1f %11.0f%%%n",
                v.label(), keyframes, compressed.length / 1024.0, pct);
        }
    }
}
