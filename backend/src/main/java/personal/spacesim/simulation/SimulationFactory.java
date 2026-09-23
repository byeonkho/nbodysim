package personal.spacesim.simulation;

import org.orekit.frames.Frame;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.body.CelestialBodyWrapperFactory;
import personal.spacesim.simulation.body.MinorBodyCatalog;
import personal.spacesim.simulation.body.MoonCatalog;
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

        // Partition into [massive | test] so NBodyDerivatives can use its
        // sumBound = massiveCount dispatch. Test particles are the bodies
        // flagged isTestParticle() in MinorBodyCatalog (NEAs) or MoonCatalog
        // (smaller moons like Mimas, Phobos); everything else — Sun, planets,
        // dwarf planets, Galileans, Titan, Triton, Charon, Earth's Moon — is
        // massive.
        List<CelestialBodyWrapper> massive = new ArrayList<>(celestialBodyNames.size());
        List<CelestialBodyWrapper> test = new ArrayList<>();
        for (String bodyName : celestialBodyNames) {
            CelestialBodyWrapper body = celestialBodyWrapperFactory.createCelestialBodyWrapper(
                    bodyName, frame, simStartDate);
            if (isTestParticle(bodyName)) {
                test.add(body);
            } else {
                massive.add(body);
            }
        }
        splitPlanetarySystems(massive);
        int massiveCount = massive.size();
        List<CelestialBodyWrapper> celestialBodies = new ArrayList<>(massive.size() + test.size());
        celestialBodies.addAll(massive);
        celestialBodies.addAll(test);

        return new Simulation(
                sessionID,
                celestialBodies,
                frame,
                integrator,
                simStartDate,
                timeStepUnit,
                keyframesPerKept,
                targetSnapshotsPerChunk,
                massiveCount
        );
    }

    /**
     * DE-440 outer-planet records describe whole systems. Resolve selected
     * massive moons out of those aggregates, conserving GM and both first
     * moments. Unselected and test-particle moon mass stays in the residual
     * parent; this is a collapsed-system approximation, not an exact planet
     * center for partially resolved systems. Earth/Moon are already separate.
     * Initialization only: O(N squared), with no integrator-step cost.
     */
    private static void splitPlanetarySystems(List<CelestialBodyWrapper> massive) {
        for (int i = 0; i < massive.size(); i++) {
            CelestialBodyWrapper parent = massive.get(i);
            List<CelestialBodyWrapper> moons = massive.stream().filter(body -> {
                MoonCatalog.Entry entry = MoonCatalog.get(body.getName());
                return entry != null && entry.parent().equalsIgnoreCase(parent.getName());
            }).toList();
            if (moons.isEmpty()) continue;
            double residualMu = parent.getMu() - moons.stream().mapToDouble(CelestialBodyWrapper::getMu).sum();
            if (residualMu <= 0) throw new IllegalArgumentException("Invalid planetary system GM");
            Vector3D position = parent.getPosition();
            Vector3D velocity = parent.getVelocity();
            List<String> referenceNames = new ArrayList<>(List.of(parent.getName()));
            for (CelestialBodyWrapper moon : moons) {
                double weight = moon.getMu() / residualMu;
                position = position.add(weight, parent.getPosition().subtract(moon.getPosition()));
                velocity = velocity.add(weight, parent.getVelocity().subtract(moon.getVelocity()));
                referenceNames.add(moon.getName());
            }
            CelestialBodyWrapper residual = new CelestialBodyWrapper(parent.getName(), residualMu,
                    parent.getRadius(), position, velocity);
            residual.setOrbitingBody(parent.getOrbitingBody());
            residual.setReferenceBodyNames(List.copyOf(referenceNames));
            massive.set(i, residual);
        }
    }

    private static boolean isTestParticle(String bodyName) {
        // Test particle if EITHER catalog says so. MinorBodyCatalog covers
        // dwarf planets (massive) and named NEAs (test); MoonCatalog covers
        // 21 named moons (7 massive, 14 test). Earth's Moon is Orekit-sourced
        // and lives outside MoonCatalog — it's classified massive via the
        // fall-through here returning false.
        MinorBodyCatalog.Entry minor = MinorBodyCatalog.get(bodyName);
        if (minor != null && minor.isTestParticle()) return true;
        MoonCatalog.Entry moon = MoonCatalog.get(bodyName);
        if (moon != null && moon.isTestParticle()) return true;
        return false;
    }
}
