package personal.spacesim.simulation.body;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.time.AbsoluteDate;
import org.orekit.utils.PVCoordinates;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.body.horizons.HorizonsClient;
import personal.spacesim.simulation.body.horizons.HorizonsResponseParser;
import personal.spacesim.simulation.body.horizons.HorizonsStateCache;

/**
 * Builds {@link CelestialBodyWrapper} instances from a body name.
 *
 * <p>Routing:
 * <ul>
 *   <li>Major planets + Pluto (Orekit DE-440 coverage) → {@code CelestialBodyFactory}
 *   <li>Minor bodies not in DE-440 (Ceres, Vesta, asteroids, etc.) →
 *       JPL Horizons HTTP at sim-submit time, cached by (SPK_ID, epoch).
 *       Horizons returns Sun-relative position+velocity in ICRF orientation;
 *       this factory adds the Sun's position in the user's chosen frame so
 *       the resulting state is consistent with Orekit-sourced bodies in the
 *       same frame.
 * </ul>
 *
 * <p>Runs once per body at sim-submit time, not per timestep — idiomatic
 * Spring DI / OO patterns are fine here.
 */
@Component
public class CelestialBodyWrapperFactory {

    private final HorizonsClient horizonsClient;
    private final HorizonsStateCache horizonsCache;

    @Autowired
    public CelestialBodyWrapperFactory(
            HorizonsClient horizonsClient,
            HorizonsStateCache horizonsCache
    ) {
        this.horizonsClient = horizonsClient;
        this.horizonsCache = horizonsCache;
    }

    public CelestialBodyWrapper createCelestialBodyWrapper(
            String name, Frame frame, AbsoluteDate date
    ) {
        String upper = name.toUpperCase();
        CelestialBodyWrapper wrapper;

        // Dispatch order: MoonCatalog → MinorBodyCatalog → Orekit.
        // Moons go first because their NAIF IDs use a different Horizons
        // query format (bare COMMAND) than minor-body SPK IDs (DES= form),
        // and each moon has a non-Sun orbitingBody set from the catalog.
        MoonCatalog.Entry moonEntry = MoonCatalog.get(upper);
        if (moonEntry != null) {
            HorizonsResponseParser.State heliocentric =
                horizonsCache.getOrFetch(
                    moonEntry.naifId(), date,
                    epoch -> horizonsClient.fetchByMajorBodyId(moonEntry.naifId(), epoch));

            PVCoordinates sunPv = CelestialBodyFactory.getSun()
                .getPVCoordinates(date, frame);
            Vector3D posInFrame = heliocentric.position().add(sunPv.getPosition());
            Vector3D velInFrame = heliocentric.velocity().add(sunPv.getVelocity());

            wrapper = new CelestialBodyWrapper(
                upper, moonEntry.mu(), moonEntry.radius(), posInFrame, velInFrame);
            wrapper.setOrbitingBody(moonEntry.parent());
            return wrapper;
        }

        MinorBodyCatalog.Entry minorEntry = MinorBodyCatalog.get(upper);
        if (minorEntry != null && !minorEntry.isOrekitSourced()) {
            HorizonsResponseParser.State heliocentric =
                horizonsCache.getOrFetch(
                    minorEntry.spkId(), date,
                    epoch -> horizonsClient.fetchByDesignation(minorEntry.spkId(), epoch));

            PVCoordinates sunPv = CelestialBodyFactory.getSun()
                .getPVCoordinates(date, frame);
            Vector3D posInFrame = heliocentric.position().add(sunPv.getPosition());
            Vector3D velInFrame = heliocentric.velocity().add(sunPv.getVelocity());

            wrapper = new CelestialBodyWrapper(
                upper, minorEntry.mu(), minorEntry.radius(), posInFrame, velInFrame);
        } else {
            // Orekit path — includes major planets, PLUTO, and Earth's MOON.
            wrapper = new CelestialBodyWrapper(upper, frame, date);
        }

        // Earth's Moon orbits Earth; everything Orekit-sourced or minor-body
        // sourced orbits the Sun. (Moons in MoonCatalog return early above
        // with their own parent already set.)
        if (upper.equals("MOON")) {
            wrapper.setOrbitingBody("EARTH");
        } else {
            wrapper.setOrbitingBody("SUN");
        }

        return wrapper;
    }
}
