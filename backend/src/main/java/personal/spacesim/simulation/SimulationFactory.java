package personal.spacesim.simulation;

import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.body.CelestialBodyWrapperFactory;
import personal.spacesim.simulation.frame.CustomFrameFactory;
import personal.spacesim.utils.math.integrators.Integrator;
import personal.spacesim.utils.math.integrators.IntegratorFactory;

import java.util.ArrayList;
import java.util.List;

@Component
public class SimulationFactory {

    private final IntegratorFactory integratorFactory;
    private final CelestialBodyWrapperFactory celestialBodyWrapperFactory;
    private final CustomFrameFactory customFrameFactory;

    @Autowired
    public SimulationFactory(IntegratorFactory integratorFactory,
                             CelestialBodyWrapperFactory celestialBodyWrapperFactory,
                             CustomFrameFactory customFrameFactory
    ) {
        this.integratorFactory = integratorFactory;
        this.celestialBodyWrapperFactory = celestialBodyWrapperFactory;
        this.customFrameFactory = customFrameFactory;
    }

    /**
     * @param keyframesPerKept        K — emit every Kth external step for
     *                                fixed-step integrators (Euler, RK4).
     *                                Ignored when {@code integratorStr}
     *                                resolves to DP853.
     * @param targetSnapshotsPerChunk N — target snapshot count per chunk
     *                                for DP853 (Mode C time-gap thinning).
     *                                Ignored for fixed-step integrators.
     */
    public Simulation createSimulation(
            String sessionID,
            List<String> celestialBodyNames,
            String frameStr,
            String integratorStr,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            int keyframesPerKept,
            int targetSnapshotsPerChunk
    ) {

        // using singleton DI instead of static method
        Frame frame = customFrameFactory.createFrame(frameStr);
        Integrator integrator = integratorFactory.createIntegrator(integratorStr);

        List<CelestialBodyWrapper> celestialBodies = new ArrayList<>();
        for (String bodyName : celestialBodyNames) {
            CelestialBodyWrapper body = celestialBodyWrapperFactory.createCelestialBodyWrapper(bodyName, frame, simStartDate);
            celestialBodies.add(body);
        }

        return new Simulation(
                sessionID,
                celestialBodies,
                frame,
                integrator,
                simStartDate,
                timeStepUnit,
                keyframesPerKept,
                targetSnapshotsPerChunk
        );
    }
}
