package personal.spacesim.apis.controller;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import personal.spacesim.dtos.SimulationChunkRequest;
import personal.spacesim.dtos.SimulationRequestDTO;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.SimulationSessionService;

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

        // calling the service
        String sessionID = simulationSessionService.createSimulation(
                celestialBodyNames,
                frame,
                integrator,
                date,
                timeStepUnit,
                1  // K=1 (no thinning); proper computation+validation lands in Task 6
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

}
