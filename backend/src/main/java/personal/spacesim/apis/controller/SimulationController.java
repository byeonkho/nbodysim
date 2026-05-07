package personal.spacesim.apis.controller;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import personal.spacesim.dtos.SimulationRequestDTO;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.SimulationSessionService;
import java.util.List;

@RestController
@RequestMapping("/api/simulation")
@CrossOrigin(origins = "*")
public class SimulationController {

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
                request.getDate(),
                TimeScalesFactory.getUTC()
        );
        List<String> celestialBodyNames = request.getCelestialBodyNames();
        String frame = request.getFrame();
        String integrator = request.getIntegrator();
        String timeStepUnit = request.getTimeStepUnit();

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

}