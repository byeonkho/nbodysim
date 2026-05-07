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
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/simulation")
public class SimulationController {

    private final Logger logger = LoggerFactory.getLogger(SimulationController.class);

    private final SimulationSessionService simulationSessionService;
    private final ZstdCompressor zstdCompressor;
    private final BinaryResponseSerializer binaryResponseSerializer;


    @Autowired
    public SimulationController(
            SimulationSessionService simulationSessionService,
            ZstdCompressor zstdCompressor,
            BinaryResponseSerializer binaryResponseSerializer
    ) {
        this.simulationSessionService = simulationSessionService;
        this.zstdCompressor = zstdCompressor;
        this.binaryResponseSerializer = binaryResponseSerializer;
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
                timeStepUnit
        );

        // building response object
        SimulationResponseDTO responseDTO = simulationSessionService.returnSimulationResponseDTO(sessionID);
        return ResponseEntity.ok(responseDTO);
    }

    /**
     * Returns the next computed chunk for the given session as a zstd-compressed
     * binary payload. Each call advances the session's internal time cursor —
     * not idempotent. URL-keyed caching can be added later when chunks become
     * uniquely addressable by (sessionID, chunkIndex).
     */
    @PostMapping(value = "/chunk", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getNextChunk(@RequestBody SimulationChunkRequest request) {
        String sessionID = request.sessionID();
        if (sessionID == null) {
            return ResponseEntity.badRequest().build();
        }

        long t0 = System.nanoTime();
        logger.info("[{}] Chunk request received", sessionID);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunkData =
                simulationSessionService.runSimulation(sessionID);
        long tSim = System.nanoTime();
        logger.info("[{}] Simulation computed in {}ms", sessionID, (tSim - t0) / 1_000_000);

        byte[] binaryPayload = binaryResponseSerializer.serialize(chunkData);
        long tBin = System.nanoTime();
        logger.info(
                "[{}] Binary serialized in {}ms ({} KB)",
                sessionID,
                (tBin - tSim) / 1_000_000,
                binaryPayload.length / 1024
        );

        byte[] compressedData = zstdCompressor.compress(binaryPayload);
        long tComp = System.nanoTime();
        logger.info(
                "[{}] Compressed in {}ms ({} KB) (total {}ms)",
                sessionID,
                (tComp - tBin) / 1_000_000,
                compressedData.length / 1024,
                (tComp - t0) / 1_000_000
        );

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(compressedData);
    }

}