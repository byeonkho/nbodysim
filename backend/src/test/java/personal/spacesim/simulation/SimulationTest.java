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

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins {@link Simulation#run()}'s emission contract for both fixed-step
 * and adaptive integrators.
 *
 * <p>Fixed-step (Euler/RK4): {@code keyframesPerKept} (K) thinning of the
 * external-step grid — at K=1 every step is kept, at K&gt;1 every Kth step
 * is kept, initial frame always kept, cross-chunk continuity preserved
 * (the second run()'s first kept step is exactly K steps after the first
 * run()'s last kept step).
 *
 * <p>Adaptive (DP853): time-gap thinning to {@code targetSnapshotsPerChunk}
 * (N) — emit when sim-time since last emission exceeds
 * {@code chunk_duration / (N-1)}. Snapshot count lands within tolerance
 * of N regardless of how many internal substeps Hipparchus took, so wire
 * size is bounded by construction (no exception throw, no add-mode
 * runaway substep capture).
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
                keyframesPerKept,
                /* targetSnapshotsPerChunk= */ 5000  // ignored for fixed-step
        );
    }

    private Simulation newDP853Sim(String sessionSuffix, int targetSnapshotsPerChunk) {
        return simulationFactory.createSimulation(
                "test-dp853-" + sessionSuffix,
                List.of("Sun", "Earth"),
                "ICRF",
                "DP853",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "weeks",
                /* keyframesPerKept= */ 1,  // ignored for DP853
                targetSnapshotsPerChunk
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
     * DP853 under Mode C (time-gap thinning) emits a snapshot count that
     * lands within tolerance of N regardless of how many internal substeps
     * Hipparchus took. Pinned at three points across the design's preset
     * range (3000–15000 per the design doc).
     */
    @Test
    void dp853EmitsApproximatelyTargetSnapshotsAtN5000() {
        Simulation sim = newDP853Sim("n5000", 5000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // ±5% tolerance: time-gap thinning emits at the first substep past
        // each gap threshold, so the actual count drifts slightly from N
        // depending on substep cadence. Design-doc verify criterion.
        int actual = chunk.size();
        assertTrue(actual >= 4750 && actual <= 5250,
                "DP853 N=5000 expected ~5000 snapshots ±5%, got " + actual);
    }

    @Test
    void dp853EmitsApproximatelyTargetSnapshotsAtN10000() {
        Simulation sim = newDP853Sim("n10000", 10000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        int actual = chunk.size();
        assertTrue(actual >= 9500 && actual <= 10500,
                "DP853 N=10000 expected ~10000 snapshots ±5%, got " + actual);
    }

    @Test
    void dp853EmitsApproximatelyTargetSnapshotsAtN15000() {
        Simulation sim = newDP853Sim("n15000", 15000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        int actual = chunk.size();
        assertTrue(actual >= 14250 && actual <= 15750,
                "DP853 N=15000 expected ~15000 snapshots ±5%, got " + actual);
    }

    /**
     * Cross-chunk continuity for DP853: the time-gap accounting carries
     * across run() invocations via the per-session {@code lastEmitTime}
     * field. The total emission count across two chunks should be roughly
     * 2N (within tolerance), not 2N+1 (which would indicate the second
     * chunk reset the timer and re-emitted at its start boundary).
     */
    @Test
    void dp853CrossChunkContinuityPreservesEmissionCadence() {
        Simulation sim = newDP853Sim("continuity", 5000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk1 = sim.run();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk2 = sim.run();

        int total = chunk1.size() + chunk2.size();
        // 2 chunks × ~5000 = ~10000, ±5%
        assertTrue(total >= 9500 && total <= 10500,
                "Two DP853 chunks at N=5000 should total ~10000 snapshots "
                        + "(continuous time-gap accounting across chunks), got " + total);
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
