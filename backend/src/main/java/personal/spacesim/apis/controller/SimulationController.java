package personal.spacesim.apis.controller;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.constants.SimulationLimits;
import personal.spacesim.dtos.SimulationChunkRequest;
import personal.spacesim.dtos.SimulationRequestDTO;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.simulation.exception.ChunkSnapshotBudgetExceededException;

import java.util.List;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private final Logger logger = LoggerFactory.getLogger(SimulationController.class);

    private final SimulationSessionService simulationSessionService;

    @Autowired
    public SimulationController(SimulationSessionService simulationSessionService) {
        this.simulationSessionService = simulationSessionService;
    }

    /**
     *
     * @param request payload consists of
     *                1. simulation start date
     *                2. list of celestial bodies to simulate
     *                3. frame
     *                4. integrator
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

        // Resolve keyframesPerKept (K) from the optional interval-in-seconds
        // request param. null → K=1 (no thinning).
        int keyframesPerKept;
        try {
            keyframesPerKept = resolveKeyframesPerKept(
                    request.keyframeIntervalSec(),
                    timeStepUnit
            );
        } catch (IllegalArgumentException e) {
            logger.warn("Rejecting /initialize with invalid keyframeIntervalSec: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }

        // calling the service
        String sessionID = simulationSessionService.createSimulation(
                celestialBodyNames,
                frame,
                integrator,
                date,
                timeStepUnit,
                keyframesPerKept
        );

        // building response object
        SimulationResponseDTO responseDTO = simulationSessionService.returnSimulationResponseDTO(sessionID);
        return ResponseEntity.ok(responseDTO);
    }

    /**
     * Computes {@code K = max(1, round(keyframeIntervalSec / stepDtSeconds))}
     * and validates {@code 1 <= K <= MAX_KEYFRAMES_PER_KEPT}. Null input
     * resolves to K=1 (no thinning).
     *
     * @throws IllegalArgumentException if the resolved K is out of range, or
     *         if {@code timeStepUnit} is unrecognized.
     */
    private static int resolveKeyframesPerKept(Double keyframeIntervalSec, String timeStepUnit) {
        if (keyframeIntervalSec == null) {
            return 1;
        }
        if (keyframeIntervalSec <= 0 || !Double.isFinite(keyframeIntervalSec)) {
            throw new IllegalArgumentException(
                    "keyframeIntervalSec must be a finite positive number, got " + keyframeIntervalSec);
        }
        double stepDtSeconds = stepDtSeconds(timeStepUnit);
        int k = (int) Math.max(1, Math.round(keyframeIntervalSec / stepDtSeconds));
        if (k > SimulationLimits.MAX_KEYFRAMES_PER_KEPT) {
            throw new IllegalArgumentException(
                    "keyframeIntervalSec resolves to K=" + k
                            + ", which exceeds the maximum " + SimulationLimits.MAX_KEYFRAMES_PER_KEPT);
        }
        return k;
    }

    private static double stepDtSeconds(String timeStepUnit) {
        return switch (timeStepUnit.toLowerCase()) {
            case "seconds" -> 1.0;
            case "hours" -> PhysicsConstants.SECONDS_PER_HOUR;
            case "days" -> PhysicsConstants.SECONDS_PER_DAY;
            case "weeks" -> PhysicsConstants.SECONDS_PER_WEEK;
            default -> throw new IllegalArgumentException("Unsupported time step unit: " + timeStepUnit);
        };
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
     * Surfaces {@link ChunkSnapshotBudgetExceededException} as 422
     * Unprocessable Entity. The user's request was syntactically valid but
     * the dynamics demand more keyframes than a single chunk can hold —
     * the client should prompt the user to coarsen settings rather than
     * retry. The async precompute path wraps the throw in
     * {@code RuntimeException}, so also unwrap one level.
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<String> handleChunkBudgetExceeded(RuntimeException ex) {
        Throwable t = ex;
        if (!(t instanceof ChunkSnapshotBudgetExceededException) && t.getCause() != null) {
            t = t.getCause();
        }
        if (t instanceof ChunkSnapshotBudgetExceededException budgetEx) {
            logger.warn("Chunk snapshot budget exceeded: {}", budgetEx.getMessage());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                    .body(budgetEx.getMessage());
        }
        throw ex;
    }

}
