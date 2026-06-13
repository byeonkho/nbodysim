package personal.spacesim.simulation;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins {@link Simulation}'s DP853 telemetry contract:
 * adaptive integrator → populated {@link Dp853Telemetry};
 * fixed-step integrators → null.
 */
@ExtendWith(SpringExtension.class)
@SpringBootTest
class SimulationTelemetryTest {

    @Autowired
    private SimulationFactory simulationFactory;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationTelemetryTest.class.getClassLoader()
                    .getResource("orekit-data-master");
            if (url != null) {
                Path path = Paths.get(url.toURI());
                DataContext.getDefault().getDataProvidersManager()
                        .addProvider(new DirectoryCrawler(path.toFile()));
            }
        } catch (URISyntaxException e) {
            throw new UncheckedIOException(new IOException(e));
        }
    }

    @Test
    void dp853PopulatesTelemetry() {
        Simulation sim = simulationFactory.createSimulation(
                "telemetry-dp853",
                List.of("Sun", "Earth"),
                "ICRF",
                "DP853",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "hours",
                1,
                500
        );
        ChunkResult result = sim.run();

        assertNotNull(result.telemetry(), "DP853 must populate telemetry");
        Dp853Telemetry t = result.telemetry();

        assertTrue(t.avgStepSeconds() > 0,
                "avg step must be positive, got " + t.avgStepSeconds());
        assertTrue(t.acceptRate() > 0 && t.acceptRate() <= 1.0,
                "accept rate must be in (0, 1], got " + t.acceptRate());
        // Benign two-body scenario: under step-size seeding the accept
        // rate sits near 100%, which also pins M7's fix (the old /12
        // estimate read ~78% on this same orbit).
        assertTrue(t.acceptRate() > 0.95,
                "accept rate for sun-earth circular orbit should be >0.95, got " + t.acceptRate());
    }

    @Test
    void eulerReportsNullTelemetry() {
        Simulation sim = simulationFactory.createSimulation(
                "telemetry-euler",
                List.of("Sun", "Earth"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "hours",
                1,
                500
        );
        ChunkResult result = sim.run();
        assertNull(result.telemetry(),
                "fixed-step integrators must report null telemetry");
    }

    @Test
    void attemptsEstimateInvertsTheEvalArithmetic() {
        // Hipparchus 3.0 DP853: 15 stage evaluations per attempt (accepted
        // or rejected) plus one initIntegration evaluation per integrate()
        // call (the initializeStep probe is skipped by step-size seeding).
        // evals = externalSteps + 15 * attempts, so the estimator must
        // invert that exactly.
        long evals = 10_000 + 15L * 12_345;
        assertEquals(12_345.0, Simulation.estimateDp853Attempts(evals, 10_000), 1e-9);
    }

    @Test
    void allAcceptedSingleSubstepChunkEstimatesOneAttemptPerStep() {
        // Smooth-orbit steady state under seeding: one accepted attempt per
        // call, 16 evaluations each (1 init + 15 stages). The estimate must
        // equal the external-step count, which makes acceptRate exactly 1.0.
        long evals = 16L * 10_000;
        assertEquals(10_000.0, Simulation.estimateDp853Attempts(evals, 10_000), 1e-9);
    }
}
