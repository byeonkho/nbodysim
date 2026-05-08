package personal.spacesim.simulation;

import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.state.GlobalState;
import personal.spacesim.simulation.state.NBodyDerivatives;
import personal.spacesim.utils.math.integrators.Integrator;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static personal.spacesim.simulation.state.GlobalState.COORDS_PER_BODY;

@Getter
@Setter
@Slf4j
public class Simulation {

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

    /**
     * Live state vector, advanced once per timestep. Carries position +
     * velocity for all bodies in the same flat layout as {@link GlobalState}.
     * Replaced each step by swap with {@link #nextStateBuffer} (so the
     * integrator can write into a scratch and we never reallocate). Index
     * {@code i*6..i*6+5} = (x, y, z, vx, vy, vz) for body i.
     */
    private double[] currentStateBuffer;
    private double[] nextStateBuffer;

    /**
     * Cached index of the Sun in {@link #celestialBodies} for snapshot
     * Sun-relative shifting; -1 if no Sun is in the system.
     */
    private final int sunIndex;

    public Simulation(
            String sessionID,
            List<CelestialBodyWrapper> celestialBodies,
            Frame frame,
            Integrator integrator,
            AbsoluteDate simStartDate,
            String timeStepUnit
    ) {
        this.sessionID = sessionID;
        this.frame = frame;
        this.celestialBodies = celestialBodies;
        this.integrator = integrator;
        this.simStartDate = simStartDate;
        this.simCurrentDate = simStartDate;
        this.timeStepUnit = timeStepUnit;
        this.derivatives = NBodyDerivatives.forBodies(celestialBodies);

        // Pack initial wrapper state into the buffer once. After this, the
        // wrappers are no longer kept in sync with the integrator state —
        // their position/velocity fields are stale by design (snapshot reads
        // pull straight from currentStateBuffer instead).
        GlobalState initial = GlobalState.pack(celestialBodies);
        this.currentStateBuffer = initial.data().clone();
        this.nextStateBuffer = new double[currentStateBuffer.length];

        // Cache Sun index so snapshot Sun-relative shifting doesn't re-search
        // the body list every timestep.
        int sunIdx = -1;
        for (int i = 0; i < celestialBodies.size(); i++) {
            if (celestialBodies.get(i).getName().equalsIgnoreCase("sun")) {
                sunIdx = i;
                break;
            }
        }
        this.sunIndex = sunIdx;
    }

    private void update() {
        double deltaTimeSeconds = convertTimeStep(timeStepUnit);
        simCurrentDate = simCurrentDate.shiftedBy(deltaTimeSeconds);

        integrator.stepInto(nextStateBuffer, currentStateBuffer, deltaTimeSeconds, derivatives);

        // Swap — the just-written nextStateBuffer becomes "current" for the
        // next snapshot/step; the old current is recycled as the new "next".
        double[] tmp = currentStateBuffer;
        currentStateBuffer = nextStateBuffer;
        nextStateBuffer = tmp;
    }

    public Map<AbsoluteDate, List<CelestialBodySnapshot>> run() {
        long startTime = System.nanoTime();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> results = new LinkedHashMap<>();

        // Emit the initial frame only on the first run; subsequent runs continue from where we left off.
        if (!hasEmittedInitialFrame) {
            results.put(simCurrentDate, snapshotFromState());
            hasEmittedInitialFrame = true;
        }

        int currentTimeStep = 0;
        while (currentTimeStep < TIMESTEPS_TO_RUN) {
            update();
            results.put(simCurrentDate, snapshotFromState());
            currentTimeStep++;
        }

        long endTime = System.nanoTime();
        double totalTimeSeconds = (endTime - startTime) / 1_000_000_000.0;

        log.info("Simulation completed for {} {} in {} seconds.", TIMESTEPS_TO_RUN, timeStepUnit, totalTimeSeconds);
        log.info("Simulation ran using frame: {}", frame.getName());

        return results;
    }

    /**
     * Build a snapshot list directly from {@link #currentStateBuffer}.
     * Sun-relative shifting (so the rendered Sun stays anchored at origin)
     * is done component-wise on primitive doubles — only the final two
     * Vector3D constructions inside each {@link CelestialBodySnapshot} are
     * unavoidable, since the snapshot record is the public wire format.
     */
    private List<CelestialBodySnapshot> snapshotFromState() {
        double[] data = currentStateBuffer;
        double sunX = 0, sunY = 0, sunZ = 0;
        double sunVx = 0, sunVy = 0, sunVz = 0;
        if (sunIndex >= 0) {
            int sunBase = sunIndex * COORDS_PER_BODY;
            sunX  = data[sunBase];
            sunY  = data[sunBase + 1];
            sunZ  = data[sunBase + 2];
            sunVx = data[sunBase + 3];
            sunVy = data[sunBase + 4];
            sunVz = data[sunBase + 5];
        }

        int n = celestialBodies.size();
        List<CelestialBodySnapshot> copy = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            int base = i * COORDS_PER_BODY;
            copy.add(new CelestialBodySnapshot(
                    celestialBodies.get(i).getName(),
                    new org.hipparchus.geometry.euclidean.threed.Vector3D(
                            data[base]     - sunX,
                            data[base + 1] - sunY,
                            data[base + 2] - sunZ),
                    new org.hipparchus.geometry.euclidean.threed.Vector3D(
                            data[base + 3] - sunVx,
                            data[base + 4] - sunVy,
                            data[base + 5] - sunVz)
            ));
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
