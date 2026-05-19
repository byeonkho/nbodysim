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
 * One-off wire-size measurement harness for chunk bandwidth (todos
 * #37 and #69). Walks realistic user-facing scenarios (full solar
 * system, 10 bodies), runs the same serialize → zstd pipeline the
 * controller uses, and prints snapshots / raw KB / zstd KB / ratio /
 * B/snap·body per row.
 *
 * <p>For DP853 (Mode C time-gap thinning), exercises the three
 * preset-relevant N values from the design doc — N=5000 / N=10000 /
 * N=15000 — so each row's snapshot count should land within ±5% of
 * its target N. That's the Phase 2 verify criterion.
 *
 * <p>Disabled by default — runs only when {@code -Dchunk.benchmark=true}.
 *
 * <p>Run:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=ChunkSizeBenchmark -Dchunk.benchmark=true
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "chunk.benchmark", matches = "true")
class ChunkSizeBenchmark {

    private static final List<String> BODIES = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    );
    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";

    private record Scenario(String label, String integrator, int k, int n) {}

    // Fixed-step rows use K (n is ignored). DP853 rows use N (k is ignored).
    // DP853 N values match the design doc preset map (bucket 2, 4, 5).
    private static final List<Scenario> SCENARIOS = List.of(
        new Scenario("euler   K=1   (highest)",   "euler", 1,  0),
        new Scenario("rk4     K=4   (default)",   "rk4",   4,  0),
        new Scenario("dp853   N=5000  (default)", "dp853", 1,  5000),
        new Scenario("dp853   N=10000 (high)",    "dp853", 1, 10000),
        new Scenario("dp853   N=15000 (highest)", "dp853", 1, 15000)
    );

    @Autowired private SimulationFactory simulationFactory;
    @Autowired private BinaryResponseSerializer binaryResponseSerializer;
    @Autowired private ZstdCompressor zstdCompressor;

    @Test
    void measure() {
        AbsoluteDate startDate = new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());

        System.out.println();
        System.out.println("Chunk-size benchmark — 10 bodies, " + TIME_STEP_UNIT + " step, ICRF");
        System.out.println("First-chunk measurement (post-initialise). Compressed bytes include the 4-byte length prefix.");
        System.out.println();
        System.out.printf("  %-44s %10s %12s %12s %8s %12s %12s%n",
            "scenario", "snapshots", "raw KB", "zstd KB", "ratio", "B/snap", "B/snap·body");
        System.out.println("  " + "-".repeat(112));

        for (Scenario s : SCENARIOS) {
            String sessionId = "chunk-bench-" + s.integrator + "-" + (s.n > 0 ? "N" + s.n : "K" + s.k);
            Simulation sim = simulationFactory.createSimulation(
                sessionId,
                BODIES, FRAME, s.integrator, startDate, TIME_STEP_UNIT,
                s.k, s.n
            );

            ChunkResult chunk = sim.run();

            LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
            for (CelestialBodyWrapper w : sim.getCelestialBodies()) {
                muByName.put(w.getName(), w.getMu());
            }

            byte[] raw = binaryResponseSerializer.serialize(chunk.snapshots(), muByName);
            byte[] compressed = zstdCompressor.compress(raw);

            int snapshots = chunk.snapshots().size();
            int bodies = BODIES.size();
            double ratio = (double) raw.length / compressed.length;
            double bytesPerSnap = (double) compressed.length / snapshots;
            double bytesPerSnapBody = bytesPerSnap / bodies;

            System.out.printf("  %-44s %10d %12.1f %12.1f %8.2f %12.1f %12.2f%n",
                s.label,
                snapshots,
                raw.length / 1024.0,
                compressed.length / 1024.0,
                ratio,
                bytesPerSnap,
                bytesPerSnapBody
            );
        }

        System.out.println();
        System.out.println("Wire-size targets (per design doc):");
        System.out.println("  Default tier (Euler/RK4): 2 MB compressed ceiling");
        System.out.println("  DP853 tier (opt-in):      6 MB compressed ceiling");
        System.out.println();
    }
}
