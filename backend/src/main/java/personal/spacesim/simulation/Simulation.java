package personal.spacesim.simulation;

import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.dtos.WebSocketResponseDTO;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;
import personal.spacesim.utils.math.integrators.Integrator;
import personal.spacesim.utils.serializers.WebSocketResponseSizeSerializer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Getter
@Setter
@Slf4j
public class Simulation {

    private final WebSocketResponseSizeSerializer responseSizeSerializer;

    private final String sessionID;
    private Frame frame;
    private List<CelestialBodyWrapper> celestialBodies;
    private AbsoluteDate simStartDate;
    private AbsoluteDate simCurrentDate;
    private Integrator integrator;
    private final NBodyDerivatives derivatives;
    private String timeStepUnit;
    private boolean hasEmittedInitialFrame = false;
    private static final int TIMESTEPS_TO_RUN = 10_000;

    public Simulation(
            String sessionID,
            List<CelestialBodyWrapper> celestialBodies,
            Frame frame,
            Integrator integrator,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            WebSocketResponseSizeSerializer responseSizeSerializer
    ) {
        this.sessionID = sessionID;
        this.frame = frame;
        this.celestialBodies = celestialBodies;
        this.integrator = integrator;
        this.simStartDate = simStartDate;
        this.simCurrentDate = simStartDate;
        this.timeStepUnit = timeStepUnit;
        this.responseSizeSerializer = responseSizeSerializer;
        this.derivatives = NBodyDerivatives.forBodies(celestialBodies);
    }

    private void update() {
        double deltaTimeSeconds = convertTimeStep(timeStepUnit);
        simCurrentDate = simCurrentDate.shiftedBy(deltaTimeSeconds);

        // Pack all bodies (including the Sun — true N-body, no special-casing).
        // The integrator advances the global state; the result is unpacked
        // back into the wrappers in-place.
        GlobalState state = GlobalState.pack(celestialBodies);
        GlobalState newState = integrator.step(state, deltaTimeSeconds, derivatives);
        newState.unpackInto(celestialBodies);
    }

    public WebSocketResponseDTO run() {
        long startTime = System.nanoTime();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> results = new LinkedHashMap<>();

        // Emit the initial frame only on the first run; subsequent runs continue from where we left off.
        if (!hasEmittedInitialFrame) {
            results.put(simCurrentDate, snapshotCelestialBodies(celestialBodies));
            hasEmittedInitialFrame = true;
        }

        int currentTimeStep = 0;
        while (currentTimeStep < TIMESTEPS_TO_RUN) {
            update();
            results.put(simCurrentDate, snapshotCelestialBodies(celestialBodies));
            currentTimeStep++;
        }

        long endTime = System.nanoTime();
        double totalTimeSeconds = (endTime - startTime) / 1_000_000_000.0;

        log.info("Simulation completed for {} {} in {} seconds.", TIMESTEPS_TO_RUN, timeStepUnit, totalTimeSeconds);
        log.info("Simulation ran using frame: {}", frame.getName());

        WebSocketResponseDTO responsePayload = new WebSocketResponseDTO();
        responsePayload.setData(results);
        responseSizeSerializer.printResponseSize(responsePayload);
        return responsePayload;
    }

    private List<CelestialBodySnapshot> snapshotCelestialBodies(List<CelestialBodyWrapper> originalList) {
        List<CelestialBodySnapshot> copy = new ArrayList<>();
        for (CelestialBodyWrapper body : originalList) {
            CelestialBodySnapshot snapshot = new CelestialBodySnapshot();
            snapshot.setPosition(body.getPosition());
            snapshot.setVelocity(body.getVelocity());
            snapshot.setName(body.getName());
            copy.add(snapshot);
        }
        return copy;
    }

    private double convertTimeStep(String timeStepUnit) {
        return switch (timeStepUnit.toLowerCase()) {
            case "seconds" -> 1;
            case "hours" -> PhysicsConstants.SECONDS_PER_HOUR;
            case "days" -> PhysicsConstants.SECONDS_PER_DAY;
            case "weeks" -> PhysicsConstants.SECONDS_PER_WEEK;
            default -> throw new IllegalArgumentException("Unsupported time step unit: " + timeStepUnit);
        };
    }
}
