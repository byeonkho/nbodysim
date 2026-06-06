package personal.spacesim.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.luben.zstd.Zstd;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.dtos.BodyGroundTruthTrack;
import personal.spacesim.dtos.GroundTruthAnchor;
import personal.spacesim.dtos.GroundTruthResponse;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.GroundTruthProvider;
import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;

/**
 * Measurement tool: quantifies JSON payload sizes for the two HTTP endpoints
 * and shows what gzip and a naive binary encoding would save.
 *
 * <p>Measures {@code GET /api/simulation/ground-truth} (the large one —
 * daily position/velocity anchors for planets + Pluto over a 1-year window)
 * and {@code POST /api/simulation/initialize} (the small, one-time body list).
 * For each payload it reports:
 * <ul>
 *   <li>{@code jsonRaw}  — exact wire size as Jackson serialises it today</li>
 *   <li>{@code jsonGzip} — gzip at default level (what nginx/browser decompression expects)</li>
 *   <li>{@code binRaw}   — naive little-endian binary: per track a length-prefixed UTF-8
 *       name, then per anchor {@code int64 epochMillis + 3×float64 position + 3×float32
 *       velocity} (float32 vel mirrors the existing chunk binary convention)</li>
 *   <li>{@code binZstd}  — zstd level 3 on the binary (same level used for chunk payloads)</li>
 * </ul>
 * A {@code % of jsonRaw} column makes the relative savings obvious.
 *
 * <p>Disabled by default. Run with:
 * <pre>
 *   cd backend
 *   ./mvnw test -Dtest=JsonPayloadBenchmark -Djson.benchmark=true -q
 * </pre>
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "json.benchmark", matches = "true")
class JsonPayloadBenchmark {

    // DEFAULT: the standard client selection (8 planets + Moon, no Pluto).
    // GroundTruthProvider will filter to supported bodies (planets only, no
    // Sun, no Moon), leaving 8 tracks for Mercury–Neptune.
    private static final List<String> BODIES_DEFAULT = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"
    );

    // FULL-SUPPORTED: adds Pluto, which GroundTruthProvider explicitly supports
    // (Pluto is in DE-440 and orbits the Sun directly). This gives 9 tracks
    // (Mercury–Neptune + Pluto), the maximum the provider yields.
    private static final List<String> BODIES_FULL_SUPPORTED = List.of(
        "Sun", "Mercury", "Venus", "Earth", "Moon",
        "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
    );

    private static final String FRAME        = "ICRF";
    private static final String INTEGRATOR   = "rk4";
    private static final String TIME_STEP_UNIT = "hours";
    // RK4 defaults: K=4 keyframes-per-kept, N=0 target-snapshots (fixed-step path only uses K).
    private static final int K = 4;
    private static final int N = 0;

    // 1-year window: from = 2026-01-01 00:00:00 UTC, to = from + 365 days.
    private static final double ONE_YEAR_SECONDS = 365 * 86_400.0;

    @Autowired private SimulationFactory        simulationFactory;
    @Autowired private SimulationSessionService simulationSessionService;
    @Autowired private GroundTruthProvider      groundTruthProvider;

    // Autowire the project's ObjectMapper so JSON output exactly matches the
    // wire: custom Vector3D / AbsoluteDate serializers + WRITE_BIGDECIMAL_AS_PLAIN.
    @Autowired private ObjectMapper objectMapper;

    @Test
    void measure() throws Exception {
        AbsoluteDate startDate =
            new AbsoluteDate(2026, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC());
        AbsoluteDate endDate = startDate.shiftedBy(ONE_YEAR_SECONDS);

        // ── Ground-truth: DEFAULT body set ────────────────────────────────────
        measureGroundTruth("DEFAULT (10 bodies, 8 supported tracks)", BODIES_DEFAULT,
            startDate, endDate);

        // ── Ground-truth: FULL-SUPPORTED body set ─────────────────────────────
        measureGroundTruth("FULL-SUPPORTED (11 bodies, 9 supported tracks)", BODIES_FULL_SUPPORTED,
            startDate, endDate);

        // ── Initialize: DEFAULT body set (small, one-time) ────────────────────
        measureInitialize("DEFAULT (10 bodies)", BODIES_DEFAULT, startDate);
    }

    // ── Ground-truth measurement ───────────────────────────────────────────────

    private void measureGroundTruth(
            String label,
            List<String> bodies,
            AbsoluteDate from,
            AbsoluteDate to
    ) throws Exception {
        // Build a Simulation exactly as the controller does when it receives a
        // ground-truth request. The controller calls:
        //   Simulation sim = simulationSessionService.getSimulation(sessionId);
        //   groundTruthProvider.sampleTracks(sim.getCelestialBodies(), sim.getFrame(), from, to)
        //
        // We replicate that path directly: create a Simulation via the factory
        // (same factory the session service uses internally), then call the
        // provider with the same getCelestialBodies() / getFrame() accessors.
        // The Frame is obtained from the Simulation's getFrame() — which itself
        // was built by CustomFrameFactory.createFrame("ICRF") inside the factory.
        // This is identical to what the controller sees.
        Simulation sim = simulationFactory.createSimulation(
            "bm-gt-" + bodies.size(),
            bodies, FRAME, INTEGRATOR, from, TIME_STEP_UNIT, K, N
        );

        // Daily cadence — matches the controller's default and the 1-anchor/day
        // figure this benchmark reports. (sampleTracks gained a stepSeconds
        // param for visible-window fetching after this harness was written.)
        GroundTruthResponse response = groundTruthProvider.sampleTracks(
            sim.getCelestialBodies(), sim.getFrame(), from, to,
            GroundTruthProvider.DAILY_CADENCE_SECONDS
        );

        int totalTracks  = response.tracks().size();
        int anchorsPerTrack = totalTracks > 0 ? response.tracks().get(0).anchors().size() : 0;
        int totalAnchors = totalTracks * anchorsPerTrack;

        byte[] jsonRaw  = objectMapper.writeValueAsBytes(response);
        byte[] jsonGzip = gzip(jsonRaw);
        byte[] binRaw   = encodeGroundTruthBinary(response);
        byte[] binZstd  = Zstd.compress(binRaw, 3);

        printSection("GROUND-TRUTH  |  " + label);
        System.out.printf("  tracks: %d   anchors/track: %d   total anchors: %d%n",
            totalTracks, anchorsPerTrack, totalAnchors);
        System.out.println();
        printTableHeader();
        printRow("jsonRaw",  jsonRaw.length,  jsonRaw.length);
        printRow("jsonGzip", jsonGzip.length, jsonRaw.length);
        printRow("binRaw",   binRaw.length,   jsonRaw.length);
        printRow("binZstd",  binZstd.length,  jsonRaw.length);
        System.out.println();
    }

    /**
     * Naive binary encoding for a GroundTruthResponse. Layout per track:
     * <pre>
     *   [int32 nameLen][UTF-8 name bytes][int32 anchorCount]
     *   then per anchor: [int64 epochMillis][f64 px][f64 py][f64 pz][f32 vx][f32 vy][f32 vz]
     * </pre>
     * All values are little-endian. Velocity is float32 (matching the existing
     * chunk binary convention where velocity is the Hermite tangent and ships
     * at reduced precision). Position stays float64 (same as chunk binary).
     *
     * <p>This is intentionally naive: no delta-encoding, no byte shuffling, no
     * header tricks. It establishes a lower-bound reference to compare against
     * JSON; the PositionEncodingExperiment covers the next level of compression
     * engineering for chunk payloads, and the same techniques apply here.
     */
    private static byte[] encodeGroundTruthBinary(GroundTruthResponse response) {
        List<BodyGroundTruthTrack> tracks = response.tracks();

        // Pre-size: per track = 4 (nameLen) + nameBytes + 4 (anchorCount)
        //           per anchor = 8 (epochMs) + 3×8 (pos f64) + 3×4 (vel f32) = 44 bytes
        int totalBytes = 0;
        for (BodyGroundTruthTrack track : tracks) {
            byte[] nameBytes = track.name().getBytes(StandardCharsets.UTF_8);
            totalBytes += 4 + nameBytes.length + 4;
            totalBytes += track.anchors().size() * (8 + 3 * 8 + 3 * 4);
        }

        ByteBuffer buf = ByteBuffer.allocate(totalBytes).order(ByteOrder.LITTLE_ENDIAN);
        for (BodyGroundTruthTrack track : tracks) {
            byte[] nameBytes = track.name().getBytes(StandardCharsets.UTF_8);
            buf.putInt(nameBytes.length);
            buf.put(nameBytes);
            buf.putInt(track.anchors().size());
            for (GroundTruthAnchor anchor : track.anchors()) {
                buf.putLong(anchor.epochMillis());
                double[] pos = anchor.position();
                buf.putDouble(pos[0]).putDouble(pos[1]).putDouble(pos[2]);
                double[] vel = anchor.velocity();
                buf.putFloat((float) vel[0]).putFloat((float) vel[1]).putFloat((float) vel[2]);
            }
        }
        return buf.array();
    }

    // ── Initialize measurement ─────────────────────────────────────────────────

    private void measureInitialize(
            String label,
            List<String> bodies,
            AbsoluteDate startDate
    ) throws Exception {
        // Use SimulationSessionService.createSimulation + returnSimulationResponseDTO
        // to mirror the exact controller code path for /initialize, including
        // the session map registration that returnSimulationResponseDTO relies on.
        String sessionId = simulationSessionService.createSimulation(
            bodies, FRAME, INTEGRATOR, startDate, TIME_STEP_UNIT, K, N
        );
        SimulationResponseDTO dto = simulationSessionService.returnSimulationResponseDTO(sessionId);

        byte[] jsonRaw  = objectMapper.writeValueAsBytes(dto);
        byte[] jsonGzip = gzip(jsonRaw);

        printSection("INITIALIZE  |  " + label);
        printTableHeader();
        printRow("jsonRaw",  jsonRaw.length,  jsonRaw.length);
        printRow("jsonGzip", jsonGzip.length, jsonRaw.length);
        System.out.println("  (binary encoding not measured for /initialize — payload is already small)");
        System.out.println();
    }

    // ── Formatting helpers ─────────────────────────────────────────────────────

    private static void printSection(String title) {
        System.out.println();
        System.out.println("════════════════════════════════════════════════════════════════");
        System.out.println("  " + title);
        System.out.println("════════════════════════════════════════════════════════════════");
    }

    private static void printTableHeader() {
        System.out.printf("  %-12s  %10s  %10s%n", "encoding", "size KB", "% of jsonRaw");
        System.out.println("  " + "-".repeat(38));
    }

    private static void printRow(String name, long bytes, long baseBytes) {
        double kb  = bytes / 1024.0;
        double pct = 100.0 * bytes / baseBytes;
        System.out.printf("  %-12s  %10.1f  %9.0f%%%n", name, kb, pct);
    }

    // ── Gzip helper ───────────────────────────────────────────────────────────

    private static byte[] gzip(byte[] data) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bos)) {
            gz.write(data);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bos.toByteArray();
    }
}
