package personal.spacesim.services;

import org.orekit.time.AbsoluteDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.dtos.SimulationResponseMetadata;
import personal.spacesim.dtos.SimulationChunkResponse;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SimulationSessionService {

    private final Logger logger = LoggerFactory.getLogger(SimulationSessionService.class);

    // Sessions idle longer than this are evicted by the periodic sweeper.
    private static final long IDLE_TIMEOUT_MS = 15 * 60 * 1000;

    private final ConcurrentHashMap<String, Simulation> simulationMap;
    private final ConcurrentHashMap<String, Long> lastAccessedAt;
    private final SimulationFactory simulationFactory;

    @Autowired
    public SimulationSessionService(SimulationFactory simulationFactory) {
        this.simulationFactory = simulationFactory;
        this.simulationMap = new ConcurrentHashMap<>();
        this.lastAccessedAt = new ConcurrentHashMap<>();
    }

    public String createSimulation(
            List<String> celestialBodyNames,
            String frame,
            String integrator,
            AbsoluteDate simStartDate,
            String timeStep
    ) {
        String sessionID = UUID.randomUUID().toString();
        Simulation simulation = simulationFactory.createSimulation(
                sessionID,
                celestialBodyNames,
                frame,
                integrator,
                simStartDate,
                timeStep
        );
        simulationMap.put(sessionID, simulation);
        lastAccessedAt.put(sessionID, System.currentTimeMillis());
        logger.info("sessionID: {}", sessionID);
        return sessionID;
    }

    public SimulationResponseDTO returnSimulationResponseDTO(String sessionID) {
        Simulation simulation = simulationMap.get(sessionID);
        List<CelestialBodyWrapper> celestialBodyList = simulation.getCelestialBodies();
        SimulationResponseMetadata simulationResponseMetadata = new SimulationResponseMetadata(sessionID);
        return new SimulationResponseDTO(celestialBodyList, simulationResponseMetadata);
    }

    public Simulation getSimulation(String sessionID) {
        return simulationMap.get(sessionID);
    }

    public List<Simulation> getAllSimulations() {
        return new ArrayList<>(simulationMap.values());
    }

    public void removeSimulation(String sessionID) {
        simulationMap.remove(sessionID);
        lastAccessedAt.remove(sessionID);
    }

    public SimulationChunkResponse runSimulation(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        if (simulation == null) {
            throw new IllegalArgumentException("Simulation not found for session ID: " + sessionID);
        }
        try {
            lastAccessedAt.put(sessionID, System.currentTimeMillis());
            return simulation.run();
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Error running simulation", e);
        }
    }

    public List<CelestialBodyWrapper> getSimulationResults(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        return simulation != null ? simulation.getCelestialBodies() : new ArrayList<>();
    }

    /**
     * Periodically evict simulations that haven't been accessed in IDLE_TIMEOUT_MS.
     * Replaces the prior WS-disconnect-triggered cleanup; with HTTP we have no
     * connection lifecycle to hook into.
     */
    @Scheduled(fixedRate = 60_000)
    public void evictIdleSimulations() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Long>> it = lastAccessedAt.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> entry = it.next();
            if (now - entry.getValue() > IDLE_TIMEOUT_MS) {
                String sessionID = entry.getKey();
                simulationMap.remove(sessionID);
                it.remove();
                logger.info("Evicted idle simulation {}", sessionID);
            }
        }
    }
}
