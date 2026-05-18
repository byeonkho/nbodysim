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
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

/**
 * One-off wire-size measurement harness for chunk bandwidth optimisation
 * (todos #37 and #69).
 *
 * <p>Walks the realistic integrator × K matrix users actually encounter
 * (full solar system, 10 bodies), runs the same serialize → zstd pipeline
 * the controller uses, and prints per-scenario:
 * <ul>
 *   <li>snapshot count</li>
 *   <li>raw bytes (post-serializer)</li>
 *   <li>compressed bytes (post-zstd, includes the 4-byte length prefix)</li>
 *   <li>compression ratio</li>
 *   <li>bytes per snapshot (raw + compressed)</li>
 *   <li>bytes per snapshot-body (the implicit unit in
 *       {@code SimulationLimits.MAX_SNAPSHOTS_PER_CHUNK} docstring)</li>
 * </ul>
 *
 * <p>Output is plain text on stdout — this is a measurement tool, not an
 * assertion. The numbers feed the wire-size target decision before any
 * format changes (float32, delta encoding) land.
 *
 * <p>The DP853 K=1 row uses an elevated snapshot budget so we can measure
 * the worst-case substep burst rather than tripping
 * {@code ChunkSnapshotBudgetExceededException} — exactly the design question
 * todo #69 is about.
 *
 * <p>Disabled by default — runs only when {@code -Dchunk.benchmark=true}
 * is passed, mirroring {@link IntegratorBenchmark}.
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

    private record Scenario(String label, String integrator, int k, int snapshotBudget) {}

    // Centered on what real users hit (per-integrator defaults from the
    // Hermite work — Euler K=1, RK4 K=4, DP853 K=8). DP853 K=4 and K=1
    // bracket the high-fidelity end; K=1 uses an elevated budget so we
    // can measure the substep-burst worst case rather than throw.
    private static final List<Scenario> SCENARIOS = List.of(
        new Scenario("euler   K=1  (default)",        "euler", 1, 100_000),
        new Scenario("rk4     K=4  (default)",        "rk4",   4, 100_000),
        new Scenario("dp853   K=8  (default)",        "dp853", 8, 100_000),
        new Scenario("dp853   K=4  (medium-high)",    "dp853", 4, 100_000),
        new Scenario("dp853   K=1  (stress — substep worst case)", "dp853", 1, 100_000)
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
            Simulation sim = simulationFactory.createSimulation(
                "chunk-bench-" + s.integrator + "-K" + s.k,
                BODIES, FRAME, s.integrator, startDate, TIME_STEP_UNIT,
                s.k, s.snapshotBudget
            );

            Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

            LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
            for (CelestialBodyWrapper w : sim.getCelestialBodies()) {
                muByName.put(w.getName(), w.getMu());
            }

            byte[] raw = binaryResponseSerializer.serialize(chunk, muByName);
            byte[] compressed = zstdCompressor.compress(raw);

            int snapshots = chunk.size();
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
        System.out.println("Target reference (todo #37): <1 MB compressed per chunk.");
        System.out.println("Current MAX_SNAPSHOTS_PER_CHUNK = 20000 (todo #69).");
        System.out.println();
    }
}
