package personal.spacesim.simulation.body;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Getter;
import lombok.Setter;
import lombok.ToString;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.bodies.CelestialBody;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.constants.PhysicsConstants;


// we can't just use CelestialBody because to retrieve the PV coordinates we need a specific datetime; by wrapping it
// here we can update the PV state through our manual compute.

@Getter
@Setter
@ToString
public class CelestialBodyWrapper {

    // Display-only: ships in the JSON body-properties payload for the UI's
    // Mass readout. Physics never reads this — the force model and
    // orbital-element code consume µ directly (below), because the mu/G
    // division loses precision.
    private final double mass;
    // Standard gravitational parameter (µ = G·M, units m³/s²). Sourced
    // directly from Orekit's getGM() — the canonical value JPL ephemerides
    // are computed against.
    private final double mu;
    private final double radius;
    private final String name;
    private String orbitingBody;

    @JsonIgnore
    private Vector3D position;
    @JsonIgnore
    private Vector3D velocity;

    public CelestialBodyWrapper(
            String name,
            Frame frame,
            AbsoluteDate date
    ) {

        CelestialBody body = CelestialBodyFactory.getBody(name);

        this.name = name;
        this.mu = body.getGM();
        this.mass = this.mu / PhysicsConstants.GRAVITATIONAL_CONSTANT;
        Double radiusValue = PhysicsConstants.RADIUS_MAP.get(name.toUpperCase());
        if (radiusValue == null) {
            throw new IllegalArgumentException("Unknown celestial body: " + name);
        }
        this.radius = radiusValue;
        this.position = body.getPVCoordinates(
                date,
                frame
        ).getPosition();
        this.velocity = body.getPVCoordinates(
                date,
                frame
        ).getVelocity();
    }

    /**
     * Construct from explicit state, bypassing Orekit's CelestialBodyFactory.
     * Used for minor bodies whose state comes from JPL Horizons (e.g. Ceres,
     * Eros) — Orekit's bundled DE-440 doesn't cover them, and Orekit doesn't
     * natively read SPK files.
     *
     * <p>{@code mass} is derived from {@code mu / G} for the JSON
     * body-properties payload (UI display only); physics consumes
     * {@code mu} directly.
     */
    public CelestialBodyWrapper(
            String name,
            double mu,
            double radius,
            Vector3D position,
            Vector3D velocity
    ) {
        this.name = name;
        this.mu = mu;
        this.mass = mu / PhysicsConstants.GRAVITATIONAL_CONSTANT;
        this.radius = radius;
        this.position = position;
        this.velocity = velocity;
    }
}

