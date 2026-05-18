package personal.spacesim.tools;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import jdk.jfr.Configuration;
import jdk.jfr.Recording;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;

/**
 * One-off measurement harness for the integrator inner loop (todo #53).
 *
 * <p>Runs a representative chunk (Sun + 9 bodies, 10K timesteps, hours unit)
 * for each integrator, prints elapsed time, and writes a JFR profile to
 * {@code /tmp/integrator-baseline.jfr}.
 *
 * <p>Disabled by default — runs only when {@code -Dintegrator.benchmark=true}
 * is passed. This keeps it out of normal CI but makes it trivial to re-run
 * after each fix to validate the speedup.
 *
 * <p>Run:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=IntegratorBenchmark -Dintegrator.benchmark=true
 * </pre>
 *
 * <p>Analyse the JFR with:
 * <pre>
 *   jfr summary /tmp/integrator-baseline.jfr
 *   jfr print --events ObjectAllocationSample /tmp/integrator-baseline.jfr
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "integrator.benchmark", matches = "true")
class IntegratorBenchmark {

    private static final List<String> BODIES = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    );
    private static final String FRAME = "ICRF";
    private static final String TIME_STEP_UNIT = "hours";
    private static final List<String> INTEGRATORS = List.of("euler", "rk4", "dp853");
    private static final int WARMUP_CHUNKS = 1;
    private static final int MEASURE_CHUNKS = 3;
    private static final Path JFR_OUTPUT = Path.of(
        System.getProperty("integrator.benchmark.jfr", "/tmp/integrator-baseline.jfr"));

    @Autowired
    private SimulationFactory simulationFactory;

    @Test
    void measure() throws Exception {
        AbsoluteDate startDate = new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());

        // Capture allocation + CPU profile across the entire measurement
        // window. The "profile" preset enables sampled allocation events,
        // execution samples, and GC events at moderate overhead.
        Configuration config = Configuration.getConfiguration("profile");
        Recording recording = new Recording(config);
        if (Files.exists(JFR_OUTPUT)) {
            Files.delete(JFR_OUTPUT);
        }
        recording.setDestination(JFR_OUTPUT);
        recording.start();

        try {
            for (String integratorName : INTEGRATORS) {
                System.out.println("=== " + integratorName + " ===");

                Simulation sim = simulationFactory.createSimulation(
                    "benchmark-" + integratorName,
                    BODIES,
                    FRAME,
                    integratorName,
                    startDate,
                    TIME_STEP_UNIT,
                    /* keyframesPerKept= */ 1,
                    /* targetSnapshotsPerChunk= */ 5000
                );

                // Warmup — let the JIT optimise the hot loop before measuring.
                for (int i = 0; i < WARMUP_CHUNKS; i++) {
                    sim.run();
                }

                long totalNanos = 0;
                for (int i = 0; i < MEASURE_CHUNKS; i++) {
                    long t0 = System.nanoTime();
                    sim.run();
                    long elapsed = System.nanoTime() - t0;
                    totalNanos += elapsed;
                    System.out.printf("  chunk %d: %.3f s%n", i + 1, elapsed / 1e9);
                }
                double avgSeconds = totalNanos / (double) MEASURE_CHUNKS / 1e9;
                System.out.printf("  avg:     %.3f s%n", avgSeconds);
            }
        } finally {
            recording.stop();
            recording.close();
            System.out.println("JFR written to " + JFR_OUTPUT.toAbsolutePath());
        }
    }
}
