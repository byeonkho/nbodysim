package personal.spacesim.apis.controller;

import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import personal.spacesim.constants.FidelityBucket;
import personal.spacesim.dtos.GroundTruthResponse;
import personal.spacesim.dtos.SimulationChunkRequest;
import personal.spacesim.dtos.SimulationRequestDTO;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.ChunkIndexConflictException;
import personal.spacesim.services.GroundTruthProvider;
import personal.spacesim.services.SessionCapacityExceededException;
import personal.spacesim.services.SessionNotFoundException;
import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.simulation.body.BodyCatalog;
import personal.spacesim.simulation.frame.CustomFrameFactory;

import java.util.Date;
import java.util.List;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private final Logger logger = LoggerFactory.getLogger(SimulationController.class);

    // Sanity upper bound on a single ground-truth window. The client sizes the
    // window to the visible trail span, which can legitimately reach centuries
    // at large time-steps, so this is generous; the provider's anchor cap and
    // overflow-safe step count are what actually bound the response. Rejects
    // only absurd/garbage inputs (and reversed windows, checked alongside).
    private static final long MAX_GROUND_TRUTH_WINDOW_MS = 3000L * 365 * 24 * 60 * 60 * 1000;

    private final SimulationSessionService simulationSessionService;
    private final GroundTruthProvider groundTruthProvider;
    private final CustomFrameFactory customFrameFactory;

    @Autowired
    public SimulationController(
            SimulationSessionService simulationSessionService,
            GroundTruthProvider groundTruthProvider,
            CustomFrameFactory customFrameFactory
    ) {
        this.simulationSessionService = simulationSessionService;
        this.groundTruthProvider = groundTruthProvider;
        this.customFrameFactory = customFrameFactory;
    }

    /**
     *
     * @param request payload consists of
     *                1. simulation start date
     *                2. list of celestial bodies to simulate
     *                3. frame
     *                4. integrator
     *                5. fidelityBucket (optional; null → per-integrator default)
     * @return returns the list of celestial bodies with position and velocity at the simulation start date as a JSON
     * object + the sessionID used
     * to identify the simulation instance the client owns.
     */
    @PostMapping("/initialize")
    public ResponseEntity<SimulationResponseDTO> initializeSimulation(@RequestBody SimulationRequestDTO request) {

        List<String> celestialBodyNames = request.celestialBodyNames();
        String frame = request.frame();
        String integrator = request.integrator();
        String timeStepUnit = request.timeStepUnit();

        // --- Input validation. Reject malformed/abusive requests with 400
        // before building anything: an unbounded or garbage body list is the
        // cheapest OOM/compute DoS vector on a small VM. ---
        if (isBlank(request.date()) || isBlank(frame) || isBlank(integrator) || isBlank(timeStepUnit)) {
            return ResponseEntity.badRequest().build();
        }
        if (celestialBodyNames == null || celestialBodyNames.isEmpty()
                || celestialBodyNames.size() > BodyCatalog.MAX_BODIES_PER_SIM) {
            return ResponseEntity.badRequest().build();
        }
        for (String name : celestialBodyNames) {
            if (!BodyCatalog.isKnown(name)) {
                logger.warn("Rejecting /initialize with unknown body name: {}", name);
                return ResponseEntity.badRequest().build();
            }
        }

        // Parse the start date. Orekit throws on malformed input; map to 400
        // rather than letting it surface as a 500 carrying an internal message.
        AbsoluteDate date;
        try {
            date = new AbsoluteDate(request.date(), TimeScalesFactory.getUTC());
        } catch (RuntimeException e) {
            logger.warn("Rejecting /initialize with unparseable date '{}': {}",
                    request.date(), e.getMessage());
            return ResponseEntity.badRequest().build();
        }

        // Resolve the fidelity bucket. Null bucket → per-integrator landing
        // default. Each bucket carries both K (used by fixed-step) and N
        // (used by DP853); the Simulation reads whichever applies to its
        // integrator type and ignores the other.
        FidelityBucket bucket;
        try {
            bucket = request.fidelityBucket() == null
                    ? FidelityBucket.defaultFor(integrator)
                    : FidelityBucket.fromWireName(request.fidelityBucket());
        } catch (IllegalArgumentException e) {
            logger.warn("Rejecting /initialize with invalid fidelityBucket / integrator: {}",
                    e.getMessage());
            return ResponseEntity.badRequest().build();
        }

        // L6: free the session this request replaces, on the request the client is
        // already making. Best-effort: null/unknown is a no-op. Done before the
        // capacity check so a resubmit never transiently trips the session cap.
        String previousSessionID = request.previousSessionID();
        if (previousSessionID != null && !previousSessionID.isBlank()) {
            simulationSessionService.removeSimulation(previousSessionID);
            logger.info("Released prior session {} on resubmit", previousSessionID);
        }

        String sessionID;
        try {
            sessionID = simulationSessionService.createSimulation(
                    celestialBodyNames,
                    frame,
                    integrator,
                    date,
                    timeStepUnit,
                    bucket.keyframesPerKept(),
                    bucket.targetSnapshotsPerChunk()
            );
        } catch (SessionCapacityExceededException e) {
            logger.warn("Rejecting /initialize: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        } catch (IllegalArgumentException e) {
            // Unknown frame / integrator surface here from their factories.
            logger.warn("Rejecting /initialize with invalid frame/integrator: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }

        // building response object
        SimulationResponseDTO responseDTO = simulationSessionService.returnSimulationResponseDTO(sessionID);
        return ResponseEntity.ok(responseDTO);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /**
     * Returns the next computed chunk for the given session as a zstd-compressed
     * binary payload. Each call advances the session's internal time cursor —
     * not idempotent. Serialization + compression live inside the service, which
     * also speculatively precomputes the chunk after the next-after-this request
     * so subsequent calls hit cache.
     */
    @PostMapping(value = "/chunk", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getNextChunk(@RequestBody SimulationChunkRequest request) {
        String sessionID = request.sessionID();
        if (sessionID == null) {
            return ResponseEntity.badRequest().build();
        }

        long t0 = System.nanoTime();
        logger.info("[{}] Chunk request received (index {})", sessionID, request.expectedChunkIndex());

        byte[] compressedData;
        try {
            compressedData = simulationSessionService.getNextChunkBytes(
                    sessionID, request.expectedChunkIndex());
        } catch (SessionNotFoundException e) {
            // Session evicted/released: a terminal condition. 410 lets the client
            // stop the retry loop and prompt a fresh run instead of hammering a 5xx.
            logger.info("[{}] Chunk request for gone session", sessionID);
            return ResponseEntity.status(HttpStatus.GONE).build();
        } catch (ChunkIndexConflictException e) {
            logger.warn("[{}] {}", sessionID, e.getMessage());
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        long tTotal = (System.nanoTime() - t0) / 1_000_000;
        logger.info("[{}] Chunk served in {}ms ({} KB)", sessionID, tTotal, compressedData.length / 1024);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(compressedData);
    }

    /**
     * Returns sparse, Sun-relative true-position tracks (from local DE-440)
     * for the requested body across [fromEpoch, toEpoch] (millis since the
     * Unix epoch, UTC), in the requested display frame. Powers the
     * reality-drift overlay. Sessionless by design: preset clip playback has
     * no session, and the data is public ephemeris, so the endpoint needs
     * only a body name and a frame code. Read-only and idempotent.
     */
    @GetMapping("/ground-truth")
    public ResponseEntity<GroundTruthResponse> getGroundTruth(
            @RequestParam String body,
            @RequestParam String frame,
            @RequestParam long fromEpoch,
            @RequestParam long toEpoch,
            // Optional cadence in seconds between samples. Absent -> daily. The
            // client sizes this to the visible window so the anchor count stays
            // bounded regardless of the simulation's time-per-step.
            @RequestParam(required = false) Double stepSeconds,
            // Whether the truth should be Sun-relative. Defaults true (clips and
            // heliocentric sessions include the Sun); the client sends false for
            // a Sun-less session so the truth matches the raw predicted frame.
            @RequestParam(required = false, defaultValue = "true") boolean subtractSun
    ) {
        // Reject malformed windows (reversed or implausibly large) with 400
        // rather than letting an out-of-range step count overflow downstream.
        // With toEpoch > fromEpoch the true difference is positive, so a
        // negative result means the subtraction overflowed (epochs at the
        // extremes of the long range): reject those as garbage too.
        long windowMs = toEpoch - fromEpoch;
        if (toEpoch <= fromEpoch || windowMs < 0 || windowMs > MAX_GROUND_TRUTH_WINDOW_MS) {
            return ResponseEntity.badRequest().build();
        }
        Frame resolvedFrame;
        try {
            resolvedFrame = customFrameFactory.createFrame(frame);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
        AbsoluteDate from = new AbsoluteDate(new Date(fromEpoch), TimeScalesFactory.getUTC());
        AbsoluteDate to = new AbsoluteDate(new Date(toEpoch), TimeScalesFactory.getUTC());
        double cadence = (stepSeconds != null && stepSeconds > 0)
                ? stepSeconds
                : GroundTruthProvider.DAILY_CADENCE_SECONDS;

        GroundTruthResponse response = groundTruthProvider.sampleTracks(
                List.of(body), resolvedFrame, from, to, cadence, subtractSun);
        return ResponseEntity.ok(response);
    }

}
