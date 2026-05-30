package personal.spacesim.simulation.body;

import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
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
 *       this factory rebuilds the absolute ICRF state and transforms it into
 *       the user's chosen frame via Orekit, so the result shares one
 *       orientation with the Orekit-sourced planets (see
 *       {@link #horizonsStateInFrame}).
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
            HorizonsResponseParser.State sunRelativeIcrf =
                horizonsCache.getOrFetch(
                    moonEntry.naifId(), date,
                    epoch -> horizonsClient.fetchByMajorBodyId(moonEntry.naifId(), epoch));

            PVCoordinates pv = horizonsStateInFrame(sunRelativeIcrf, frame, date);

            wrapper = new CelestialBodyWrapper(
                upper, moonEntry.mu(), moonEntry.radius(),
                pv.getPosition(), pv.getVelocity());
            wrapper.setOrbitingBody(moonEntry.parent());
            return wrapper;
        }

        MinorBodyCatalog.Entry minorEntry = MinorBodyCatalog.get(upper);
        if (minorEntry != null && !minorEntry.isOrekitSourced()) {
            HorizonsResponseParser.State sunRelativeIcrf =
                horizonsCache.getOrFetch(
                    minorEntry.spkId(), date,
                    epoch -> horizonsClient.fetchByDesignation(minorEntry.spkId(), epoch));

            PVCoordinates pv = horizonsStateInFrame(sunRelativeIcrf, frame, date);

            wrapper = new CelestialBodyWrapper(
                upper, minorEntry.mu(), minorEntry.radius(),
                pv.getPosition(), pv.getVelocity());
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

    /**
     * Place a JPL Horizons state into the simulation frame.
     *
     * <p>Horizons returns a Sun-relative position+velocity in ICRF orientation
     * (CENTER='@10', REF_PLANE='FRAME', REF_SYSTEM='ICRF'). The simulation
     * frame may have a DIFFERENT orientation than ICRF — the "Heliocentric"
     * frame, for instance, is oriented to the Sun's equator, which is tilted
     * roughly 26 degrees from the ICRF equator. Simply adding the Sun's
     * position (expressed in the sim frame) to a vector still expressed in ICRF
     * axes mixes orientations: it leaves the Horizons body rotated relative to
     * the Orekit-sourced planets, so a moon ends up tens of degrees off its
     * parent (at Saturn's distance that is several AU — the moon visibly spawns
     * away from the planet and drifts off).
     *
     * <p>Correct placement rebuilds the body's absolute ICRF state (add the
     * Sun's absolute ICRF state to the Sun-relative Horizons vector), then lets
     * Orekit's frame machinery both rotate and translate it into the sim frame.
     * Orekit-sourced planets already come through {@code getPVCoordinates(date,
     * frame)}, so after this both sources share one orientation in every frame
     * mode (Heliocentric, ICRF, GCRF). Frame transforms carry the velocity term
     * too, so the moon's velocity is rotated into the same axes as its position.
     */
    private static PVCoordinates horizonsStateInFrame(
            HorizonsResponseParser.State sunRelativeIcrf, Frame frame, AbsoluteDate date
    ) {
        Frame icrf = FramesFactory.getICRF();
        PVCoordinates sunIcrf = CelestialBodyFactory.getSun().getPVCoordinates(date, icrf);
        PVCoordinates bodyAbsIcrf = new PVCoordinates(
            sunRelativeIcrf.position().add(sunIcrf.getPosition()),
            sunRelativeIcrf.velocity().add(sunIcrf.getVelocity()));
        return icrf.getTransformTo(frame, date).transformPVCoordinates(bodyAbsIcrf);
    }
}
