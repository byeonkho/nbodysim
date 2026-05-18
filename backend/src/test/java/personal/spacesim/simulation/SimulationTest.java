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
     * DP853 under Mode C (time-gap thinning with interpolator-based
     * emission) emits exactly N snapshots per chunk, regardless of how
     * many internal substeps Hipparchus took. Emissions land at exact
     * schedule timestamps (interpolated state) rather than at substep
     * timestamps, so snapshot count is deterministic.
     */
    @Test
    void dp853EmitsExactlyTargetSnapshotsAtN5000() {
        Simulation sim = newDP853Sim("n5000", 5000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // Exact count = initial frame (at simStart) + N-1 scheduled emissions
        // at simStart + k*gap for k=1..N-1. Equals N.
        assertEquals(5000, chunk.size(),
                "DP853 N=5000 should emit exactly 5000 snapshots (uniform schedule)");
    }

    @Test
    void dp853EmitsExactlyTargetSnapshotsAtN10000() {
        Simulation sim = newDP853Sim("n10000", 10000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        assertEquals(10000, chunk.size(),
                "DP853 N=10000 should emit exactly 10000 snapshots");
    }

    @Test
    void dp853EmitsExactlyTargetSnapshotsAtN15000() {
        Simulation sim = newDP853Sim("n15000", 15000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        assertEquals(15000, chunk.size(),
                "DP853 N=15000 should emit exactly 15000 snapshots");
    }

    /**
     * The critical Phase-2-bug-regression test: DP853 emissions must land
     * at exact, uniformly-spaced sim-time intervals. Trail.tsx and other
     * index-iterating consumers assume uniform spacing; non-uniform
     * timestamps produce visible wobble between adjacent buffer indices.
     *
     * <p>Originally regressed at higher N (where substep period &gt; gap
     * caused emissions to jitter past their schedule targets). Fixed by
     * routing emissions through Hipparchus's interpolator to compute state
     * at exact target times.
     */
    @Test
    void dp853TimestampsAreUniformlySpaced() {
        Simulation sim = newDP853Sim("uniform", 5000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // chunk_duration = 10000 weeks; gap = chunk_duration / (N-1)
        double expectedGapSeconds = (10000.0 * 7 * 86400.0) / (5000 - 1);

        AbsoluteDate prev = null;
        for (AbsoluteDate d : chunk.keySet()) {
            if (prev != null) {
                double dt = d.durationFrom(prev);
                assertEquals(expectedGapSeconds, dt, 1e-6,
                        "Consecutive emission timestamps must be exactly gap "
                                + "apart (no substep-timing jitter)");
            }
            prev = d;
        }
    }

    /**
     * Cross-chunk continuity for DP853: the time-gap accounting carries
     * across run() invocations via the per-session
     * {@code adaptiveEmitCount} field. Chunk 1 emits N samples (initial +
     * N-1 scheduled targets ending at chunk_end). Chunk 2 picks up the
     * schedule without re-emitting the initial — its last target is also
     * at chunk_end-of-chunk-2, but chunk 1's last target already covers
     * the shared boundary. Total = N + (N-1) = 2N-1.
     */
    @Test
    void dp853CrossChunkContinuityPreservesEmissionCadence() {
        Simulation sim = newDP853Sim("continuity", 5000);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk1 = sim.run();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk2 = sim.run();

        assertEquals(5000, chunk1.size(),
                "Chunk 1 should emit initial + 4999 scheduled = 5000");
        assertEquals(4999, chunk2.size(),
                "Chunk 2 should continue the schedule (no initial re-emit) = 4999");
        // Combined: 2N-1, not 2N — chunk 2 doesn't double-count the boundary.
        assertEquals(9999, chunk1.size() + chunk2.size());
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
