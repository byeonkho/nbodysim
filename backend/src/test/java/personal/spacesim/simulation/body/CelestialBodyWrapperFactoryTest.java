package personal.spacesim.simulation.body;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.body.horizons.HorizonsClient;
import personal.spacesim.simulation.body.horizons.HorizonsResponseParser;
import personal.spacesim.simulation.body.horizons.HorizonsStateCache;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class CelestialBodyWrapperFactoryTest {

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = CelestialBodyWrapperFactoryTest.class.getClassLoader()
                    .getResource("orekit-data-master");
            if (url != null) {
                Path path = Paths.get(url.toURI());
                DataContext.getDefault().getDataProvidersManager()
                        .addProvider(new DirectoryCrawler(path.toFile()));
            }
        } catch (URISyntaxException e) {
            throw new UncheckedIOException(new IOException(e));
        }
    }

    @Test
    void majorPlanetGoesThroughOrekit_horizonsClientUntouched() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        HorizonsStateCache cache = new HorizonsStateCache();
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        CelestialBodyWrapper earth =
            factory.createCelestialBodyWrapper("EARTH", icrf, j2000);

        assertEquals("EARTH", earth.getName());
        assertTrue(earth.getPosition().getNorm() > 1e11,
            "Earth at J2000 should be ~1 AU from SSB in ICRF");
        verifyNoInteractions(mockClient);
    }

    @Test
    void plutoRoutedThroughOrekit_notHorizons() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        HorizonsStateCache cache = new HorizonsStateCache();
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        CelestialBodyWrapper pluto =
            factory.createCelestialBodyWrapper("PLUTO", icrf, j2000);

        assertEquals("PLUTO", pluto.getName());
        // Pluto is at ~30+ AU in J2000 — at least ~4e12 m.
        assertTrue(pluto.getPosition().getNorm() > 1e12,
            "Pluto distance must be at least ~30 AU");
        verifyNoInteractions(mockClient);
    }

    @Test
    void minorBodyEros_routedThroughHorizons() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        // Canned Horizons response: Sun-relative position ~2e11 m, vel ~14 km/s.
        when(mockClient.fetchState(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2.0e11, 1.0e11, 1.0e10),
                new Vector3D(1.0e4,  1.0e4,  0.0)));

        HorizonsStateCache cache = new HorizonsStateCache();
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame heliocentric = new personal.spacesim.simulation.frame.CustomFrameFactory()
            .createFrame("heliocentric");
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        CelestialBodyWrapper eros =
            factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);

        assertEquals("EROS", eros.getName());
        assertEquals(personal.spacesim.simulation.body.MinorBodyCatalog.get("EROS").mu(),
            eros.getMu(), 0.0);
        // In Heliocentric frame the Sun is at origin, so Horizons output is
        // used directly without offset.
        assertEquals(2.0e11, eros.getPosition().getX(), 1.0);
        assertEquals(1.0e11, eros.getPosition().getY(), 1.0);
        verify(mockClient).fetchState("2000433", j2000);
    }

    @Test
    void minorBodyInICRFFrame_addsSunOffsetToPosition() {
        // The mock returns a Sun-relative position. In ICRF (SSB-centered),
        // the body's position must equal (Sun-relative) + (Sun position in
        // ICRF). At J2000 the Sun is offset from SSB by ~1e9 m (mostly due
        // to Jupiter); the body position must therefore differ from the
        // raw mock output by that amount.
        Vector3D horizonsPos = new Vector3D(2.0e11, 0.0, 0.0);
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchState(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(horizonsPos, Vector3D.ZERO));

        HorizonsStateCache cache = new HorizonsStateCache();
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        CelestialBodyWrapper eros =
            factory.createCelestialBodyWrapper("EROS", icrf, j2000);

        // Position should NOT equal horizonsPos exactly — SSB offset shifts it.
        double diffX = Math.abs(eros.getPosition().getX() - horizonsPos.getX());
        assertTrue(diffX > 1e8, "Expected SSB-relative offset > 1e8 m; got " + diffX);
    }

    @Test
    void horizonsCacheHit_skipsClient() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchState(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2e11, 1e11, 1e10),
                new Vector3D(1e4, 1e4, 0)));
        HorizonsStateCache cache = new HorizonsStateCache();

        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame heliocentric = new personal.spacesim.simulation.frame.CustomFrameFactory()
            .createFrame("heliocentric");
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;

        factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);
        factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);

        // Second call must hit cache.
        verify(mockClient, times(1)).fetchState("2000433", j2000);
    }

    @Test
    void moonOrbitingBodyIsEarth() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        HorizonsStateCache cache = new HorizonsStateCache();
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        CelestialBodyWrapper moon = factory.createCelestialBodyWrapper(
            "MOON", icrf, AbsoluteDate.J2000_EPOCH);

        assertEquals("EARTH", moon.getOrbitingBody());
        verifyNoInteractions(mockClient);
    }
}
