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
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import personal.spacesim.simulation.exception.ChunkSnapshotBudgetExceededException;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins {@link Simulation#run()}'s keyframe-thinning emission contract.
 * At K=1 every step is kept; at K&gt;1 every Kth step is kept, with the
 * initial frame always kept and cross-chunk continuity preserved (the
 * second run()'s first kept step is exactly K steps after the first
 * run()'s last kept step).
 */
@ExtendWith(SpringExtension.class)
@SpringBootTest
class SimulationTest {

    @Autowired
    private SimulationFactory simulationFactory;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationTest.class.getClassLoader()
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

    private Simulation newSim(int keyframesPerKept) {
        return simulationFactory.createSimulation(
                "test-session-" + keyframesPerKept,
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "seconds",
                keyframesPerKept
        );
    }

    private Simulation newDP853Sim(String sessionSuffix, int keyframesPerKept, int maxSnapshotsPerChunk) {
        return simulationFactory.createSimulation(
                "test-dp853-" + sessionSuffix,
                List.of("Sun", "Earth"),
                "ICRF",
                "DP853",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "weeks",
                keyframesPerKept,
                maxSnapshotsPerChunk
        );
    }

    @Test
    void kEquals4FirstChunkEmits2501Frames() {
        Simulation sim = newSim(4);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 2500 kept steps (steps 4, 8, ..., 10000)
        assertEquals(2501, chunk.size(),
                "K=4 first chunk should emit 1 initial + 2500 thinned keyframes");
    }

    @Test
    void kEquals1FirstChunkEmits10001Frames() {
        Simulation sim = newSim(1);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 10000 kept steps (every step kept)
        assertEquals(10001, chunk.size(),
                "K=1 first chunk should emit every integration step");
    }

    @Test
    void kEquals8FirstChunkEmits1251Frames() {
        Simulation sim = newSim(8);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 1250 kept steps (steps 8, 16, ..., 10000)
        assertEquals(1251, chunk.size(),
                "K=8 first chunk should emit 1 initial + 1250 thinned keyframes");
    }

    @Test
    void kEquals4CrossChunkContinuityHoldsAtBoundary() {
        Simulation sim = newSim(4);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk1 = sim.run();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk2 = sim.run();

        // chunk1 last kept = global step 10000
        // chunk2 first kept = global step 10004 (4 steps later)
        // At timeStepUnit="seconds", that's 4.0 seconds apart.
        AbsoluteDate lastOfChunk1 = lastKey(chunk1);
        AbsoluteDate firstOfChunk2 = firstKey(chunk2);
        double dtSeconds = firstOfChunk2.durationFrom(lastOfChunk1);

        assertEquals(4.0, dtSeconds, 1e-9,
                "Chunk N+1's first kept keyframe must be exactly K steps after "
                        + "Chunk N's last kept keyframe (no boundary gap)");

        // Chunk 2 has no initial-frame emission, so it should have one fewer
        // entry than Chunk 1 at the same K.
        assertEquals(2500, chunk2.size(),
                "Second chunk should emit only thinned keyframes, no initial");
    }

    /**
     * With DP853 + dt=1 week (>{@code MAX_STEP}=1 day), Hipparchus must
     * accept ≥6 intermediate substeps per external step. Each of those
     * intermediates is emitted alongside the regular external-step
     * keyframes, so the chunk must contain strictly more than the today
     * fixed count of 10001 (1 initial + 10000 external).
     */
    @Test
    void dp853ChunkContainsIntermediateSubsteps() {
        Simulation sim = newDP853Sim("substeps", 1, 10_000_000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        assertTrue(chunk.size() > 10_001,
                "DP853 chunk should contain intermediate substeps in addition "
                        + "to the 10001 external-step keyframes; got " + chunk.size());
    }

    @Test
    void exceedingSnapshotBudgetThrowsClearException() {
        Simulation sim = newDP853Sim("budget", 1, 5);

        assertThrows(ChunkSnapshotBudgetExceededException.class, sim::run);
    }

    private static AbsoluteDate firstKey(Map<AbsoluteDate, List<CelestialBodySnapshot>> m) {
        return m.keySet().iterator().next();
    }

    private static AbsoluteDate lastKey(Map<AbsoluteDate, List<CelestialBodySnapshot>> m) {
        AbsoluteDate last = null;
        for (AbsoluteDate d : m.keySet()) {
            last = d;
        }
        return last;
    }
}
