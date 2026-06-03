package personal.spacesim.services;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.bodies.CelestialBody;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.orekit.utils.PVCoordinates;
import org.springframework.stereotype.Component;
import personal.spacesim.dtos.BodyGroundTruthTrack;
import personal.spacesim.dtos.GroundTruthAnchor;
import personal.spacesim.dtos.GroundTruthResponse;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.body.MinorBodyCatalog;
import personal.spacesim.simulation.body.MoonCatalog;

import java.util.ArrayList;
import java.util.List;

/**
 * Produces sparse, Sun-relative true-position tracks for a session's bodies,
 * sampled from Orekit's bundled DE-440 ephemeris. Used by the reality-drift
 * overlay: the client compares these true positions against the integrator's
 * predicted positions.
 *
 * <p>Only planets + Pluto are supported in v1 (bodies the local ephemeris
 * covers and that orbit the Sun directly). Moons and Horizons-sourced minor
 * bodies are omitted — see {@link #isSupported}.
 *
 * <p>Sun-relative convention matches {@code Simulation.snapshotFromState}:
 * each body's state minus the Sun's state, both expressed in the session
 * frame. This is computed from the ephemeris (not the integrator), so at the
 * simulation start the truth coincides with the seeded predicted state and
 * then diverges as the integrator accumulates error.
 *
 * <p>Runs at request time (not per timestep), so idiomatic OO is fine.
 */
@Component
public class GroundTruthProvider {

    /** 1 sample per day. A smooth orbit reconstructs to far below a pixel from
     *  daily anchors plus client-side Hermite interpolation. */
    private static final double DAILY_CADENCE_SECONDS = 86_400.0;

    public GroundTruthResponse sampleTracks(
            List<CelestialBodyWrapper> bodies,
            Frame frame,
            AbsoluteDate from,
            AbsoluteDate to
    ) {
        List<BodyGroundTruthTrack> tracks = new ArrayList<>();
        for (CelestialBodyWrapper body : bodies) {
            if (isSupported(body)) {
                tracks.add(sampleBody(body.getName(), frame, from, to));
            }
        }
        return new GroundTruthResponse(tracks);
    }

    private BodyGroundTruthTrack sampleBody(
            String name, Frame frame, AbsoluteDate from, AbsoluteDate to
    ) {
        CelestialBody body = CelestialBodyFactory.getBody(name);
        CelestialBody sun = CelestialBodyFactory.getSun();

        double totalSeconds = to.durationFrom(from);
        int steps = totalSeconds <= 0 ? 0 : (int) Math.floor(totalSeconds / DAILY_CADENCE_SECONDS);

        List<GroundTruthAnchor> anchors = new ArrayList<>(steps + 1);
        for (int i = 0; i <= steps; i++) {
            AbsoluteDate date = from.shiftedBy(i * DAILY_CADENCE_SECONDS);
            PVCoordinates bodyPv = body.getPVCoordinates(date, frame);
            PVCoordinates sunPv = sun.getPVCoordinates(date, frame);
            Vector3D pos = bodyPv.getPosition().subtract(sunPv.getPosition());
            Vector3D vel = bodyPv.getVelocity().subtract(sunPv.getVelocity());
            // Same conversion the binary serializer uses, so anchor timestamps
            // share the wire's millis-UTC scale.
            long epochMillis = date.toDate(TimeScalesFactory.getUTC()).getTime();
            anchors.add(new GroundTruthAnchor(
                    epochMillis,
                    new double[]{pos.getX(), pos.getY(), pos.getZ()},
                    new double[]{vel.getX(), vel.getY(), vel.getZ()}
            ));
        }
        return new BodyGroundTruthTrack(name, anchors);
    }

    /**
     * A body is supported iff it is a Sun-orbiting body whose state Orekit
     * sources from the bundled DE-440 — i.e. a major planet or Pluto. Excludes
     * the Sun itself, Earth's Moon (orbits Earth), catalog moons, and
     * Horizons-sourced minor bodies. Mirrors the Orekit-path branch in
     * {@code CelestialBodyWrapperFactory}.
     */
    private boolean isSupported(CelestialBodyWrapper w) {
        String upper = w.getName().toUpperCase();
        if (upper.equals("SUN")) {
            return false;
        }
        if (!"SUN".equalsIgnoreCase(w.getOrbitingBody())) {
            return false; // moons orbit a planet, not the Sun
        }
        if (MoonCatalog.get(upper) != null) {
            return false;
        }
        MinorBodyCatalog.Entry minor = MinorBodyCatalog.get(upper);
        return minor == null || minor.isOrekitSourced();
    }
}
