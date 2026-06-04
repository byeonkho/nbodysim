package personal.spacesim.apis.controller;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import personal.spacesim.constants.FidelityBucket;
import personal.spacesim.dtos.SimulationChunkRequest;
import personal.spacesim.dtos.SimulationRequestDTO;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.SimulationSessionService;

import java.util.Date;
import java.util.List;
import personal.spacesim.dtos.GroundTruthResponse;
import personal.spacesim.services.GroundTruthProvider;
import personal.spacesim.simulation.Simulation;

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

    @Autowired
    public SimulationController(
            SimulationSessionService simulationSessionService,
            GroundTruthProvider groundTruthProvider
    ) {
        this.simulationSessionService = simulationSessionService;
        this.groundTruthProvider = groundTruthProvider;
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

        // get parameters from payload
        AbsoluteDate date = new AbsoluteDate(
                request.date(),
                TimeScalesFactory.getUTC()
        );
        List<String> celestialBodyNames = request.celestialBodyNames();
        String frame = request.frame();
        String integrator = request.integrator();
        String timeStepUnit = request.timeStepUnit();

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

        String sessionID = simulationSessionService.createSimulation(
                celestialBodyNames,
                frame,
                integrator,
                date,
                timeStepUnit,
                bucket.keyframesPerKept(),
                bucket.targetSnapshotsPerChunk()
        );

        // building response object
        SimulationResponseDTO responseDTO = simulationSessionService.returnSimulationResponseDTO(sessionID);
        return ResponseEntity.ok(responseDTO);
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
        logger.info("[{}] Chunk request received", sessionID);

        byte[] compressedData = simulationSessionService.getNextChunkBytes(sessionID);

        long tTotal = (System.nanoTime() - t0) / 1_000_000;
        logger.info(
                "[{}] Chunk served in {}ms ({} KB)",
                sessionID,
                tTotal,
                compressedData.length / 1024
        );

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(compressedData);
    }

    /**
     * Returns sparse, Sun-relative true-position tracks (from local DE-440)
     * for the planets + Pluto in the given session, across [fromEpoch, toEpoch]
     * (millis since the Unix epoch, UTC). Powers the reality-drift overlay.
     * Read-only and idempotent; does not advance the session.
     */
    @GetMapping("/ground-truth")
    public ResponseEntity<GroundTruthResponse> getGroundTruth(
            @RequestParam String sessionId,
            @RequestParam long fromEpoch,
            @RequestParam long toEpoch,
            // Optional: restrict to a single body (the client requests only the
            // focused body, since that is all the overlay renders). Absent → all
            // supported bodies (kept for backward compatibility).
            @RequestParam(required = false) String body,
            // Optional cadence in seconds between samples. Absent → daily. The
            // client sizes this to the visible window so the anchor count stays
            // bounded regardless of the simulation's time-per-step.
            @RequestParam(required = false) Double stepSeconds
    ) {
        Simulation simulation = simulationSessionService.getSimulation(sessionId);
        if (simulation == null) {
            return ResponseEntity.notFound().build();
        }
        // Reject malformed windows (reversed or implausibly large) with 400
        // rather than letting an out-of-range step count overflow downstream.
        if (toEpoch <= fromEpoch || (toEpoch - fromEpoch) > MAX_GROUND_TRUTH_WINDOW_MS) {
            return ResponseEntity.badRequest().build();
        }
        AbsoluteDate from = new AbsoluteDate(new Date(fromEpoch), TimeScalesFactory.getUTC());
        AbsoluteDate to = new AbsoluteDate(new Date(toEpoch), TimeScalesFactory.getUTC());

        var bodies = simulation.getCelestialBodies();
        if (body != null && !body.isBlank()) {
            bodies = bodies.stream()
                    .filter(b -> b.getName().equalsIgnoreCase(body))
                    .toList();
        }
        double cadence = (stepSeconds != null && stepSeconds > 0)
                ? stepSeconds
                : GroundTruthProvider.DAILY_CADENCE_SECONDS;

        GroundTruthResponse response = groundTruthProvider.sampleTracks(
                bodies, simulation.getFrame(), from, to, cadence);
        return ResponseEntity.ok(response);
    }

}
