package personal.spacesim.simulation.body;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.bodies.CelestialBody;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
import org.orekit.time.AbsoluteDate;
import org.orekit.utils.PVCoordinates;
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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class CelestialBodyWrapperFactoryTest {

    @TempDir
    Path horizonsCacheDir;

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
        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
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
        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
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
        when(mockClient.fetchByDesignation(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2.0e11, 1.0e11, 1.0e10),
                new Vector3D(1.0e4,  1.0e4,  0.0)));

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame heliocentric = new personal.spacesim.simulation.frame.CustomFrameFactory()
            .createFrame("heliocentric");
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        CelestialBodyWrapper eros =
            factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);

        assertEquals("EROS", eros.getName());
        assertEquals(MinorBodyCatalog.get("EROS").mu(), eros.getMu(), 0.0);
        // Heliocentric frame: the Sun is at the origin, so there is NO
        // translation. But the Horizons vector is expressed in ICRF
        // orientation and must be ROTATED into the heliocentric (Sun-equator)
        // frame so it shares orientation with the Orekit-sourced planets.
        // Rotation preserves magnitude, so the norm — not the raw components —
        // is the invariant. The components themselves rotate by the
        // ICRF→Sun-equator angle (~26°), which is exactly the bug this fix
        // closes (a moon/asteroid otherwise lands rotated off its parent).
        Vector3D sunRelativeIcrf = new Vector3D(2.0e11, 1.0e11, 1.0e10);
        assertEquals(sunRelativeIcrf.getNorm(), eros.getPosition().getNorm(), 1.0,
            "Heliocentric placement is a pure rotation of the Sun-relative "
                + "Horizons vector, so its magnitude must be preserved");
        // And the components are NOT the raw input — proves the rotation ran.
        assertNotEquals(2.0e11, eros.getPosition().getX(), 1.0e8);
        verify(mockClient).fetchByDesignation("2000433", j2000);
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
        when(mockClient.fetchByDesignation(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(horizonsPos, Vector3D.ZERO));

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
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
        when(mockClient.fetchByDesignation(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2e11, 1e11, 1e10),
                new Vector3D(1e4, 1e4, 0)));
        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);

        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame heliocentric = new personal.spacesim.simulation.frame.CustomFrameFactory()
            .createFrame("heliocentric");
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;

        factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);
        factory.createCelestialBodyWrapper("EROS", heliocentric, j2000);

        // Second call must hit cache.
        verify(mockClient, times(1)).fetchByDesignation("2000433", j2000);
    }

    @Test
    void moonOrbitingBodyIsEarth() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        CelestialBodyWrapper moon = factory.createCelestialBodyWrapper(
            "MOON", icrf, AbsoluteDate.J2000_EPOCH);

        assertEquals("EARTH", moon.getOrbitingBody());
        verifyNoInteractions(mockClient);
    }

    @Test
    void titanRoutedThroughHorizonsBareId_withSaturnAsParent() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchByMajorBodyId(eq("606"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(1.4e12, 0, 0),    // ~Saturn distance
                new Vector3D(0, 1.0e4, 0)));

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame icrf = FramesFactory.getICRF();
        CelestialBodyWrapper titan =
            factory.createCelestialBodyWrapper("TITAN", icrf, AbsoluteDate.J2000_EPOCH);

        assertEquals("TITAN", titan.getName());
        assertEquals("SATURN", titan.getOrbitingBody());
        verify(mockClient, times(1)).fetchByMajorBodyId(eq("606"), any(AbsoluteDate.class));
        // Asteroid path must NOT be used for a moon.
        verify(mockClient, never()).fetchByDesignation(anyString(), any(AbsoluteDate.class));
    }

    @Test
    void ioRoutedThroughHorizonsBareId_withJupiterAsParent() {
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchByMajorBodyId(eq("501"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(7.78e11, 0, 0), new Vector3D(0, 1.7e4, 0)));

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        CelestialBodyWrapper io = factory.createCelestialBodyWrapper(
            "IO", FramesFactory.getICRF(), AbsoluteDate.J2000_EPOCH);

        assertEquals("JUPITER", io.getOrbitingBody());
    }

    @Test
    void erosStillUsesDesignationPath() {
        // Regression check — existing asteroid path must not break.
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchByDesignation(eq("2000433"), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2.0e11, 0, 0), new Vector3D(0, 2.0e4, 0)));

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        CelestialBodyWrapper eros = factory.createCelestialBodyWrapper(
            "EROS", FramesFactory.getICRF(), AbsoluteDate.J2000_EPOCH);

        assertEquals("SUN", eros.getOrbitingBody());
        verify(mockClient, times(1)).fetchByDesignation(eq("2000433"), any(AbsoluteDate.class));
        verify(mockClient, never()).fetchByMajorBodyId(anyString(), any(AbsoluteDate.class));
    }

    @Test
    void horizonsMoonCoLocatesWithOrekitParent_heliocentric() {
        assertHorizonsBodyCoLocatesWithSaturn("heliocentric");
    }

    @Test
    void horizonsMoonCoLocatesWithOrekitParent_icrf() {
        assertHorizonsBodyCoLocatesWithSaturn("icrf");
    }

    /**
     * Two-sided cross-source contract: a body sourced from JPL Horizons
     * (Sun-relative ICRF) must land in the SAME orientation as a body sourced
     * from Orekit, in whatever frame the simulation runs. Regressing this is
     * what made Jupiter's and Saturn's moons spawn several AU from their parent
     * and immediately drift off: the factory used to add the Sun's position
     * (expressed in the sim frame) to a vector still in ICRF axes, leaving
     * Horizons bodies rotated relative to the Orekit planets by the frame's
     * orientation (~26° for the Sun-equator "Heliocentric" frame, ~3.7 AU at
     * Saturn's distance).
     *
     * <p>The test feeds MIMAS (NAIF 601) a synthetic Horizons state equal to
     * Saturn's OWN Sun-relative ICRF state, then asserts the factory places it
     * exactly on Orekit's Saturn in the sim frame. Placing the body at the
     * planet (rather than one real moon-orbit away) makes the expected result
     * unambiguous and the orientation-mismatch failure mode maximally visible.
     * Frame-agnostic: it must hold for Heliocentric AND ICRF.
     */
    private void assertHorizonsBodyCoLocatesWithSaturn(String frameName) {
        Frame icrf = FramesFactory.getICRF();
        AbsoluteDate date = AbsoluteDate.J2000_EPOCH;

        CelestialBody saturn = CelestialBodyFactory.getBody("SATURN");
        CelestialBody sun = CelestialBodyFactory.getSun();
        PVCoordinates satIcrf = saturn.getPVCoordinates(date, icrf);
        PVCoordinates sunIcrf = sun.getPVCoordinates(date, icrf);

        HorizonsResponseParser.State synthetic = new HorizonsResponseParser.State(
            satIcrf.getPosition().subtract(sunIcrf.getPosition()),
            satIcrf.getVelocity().subtract(sunIcrf.getVelocity()));

        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchByMajorBodyId(eq("601"), any(AbsoluteDate.class)))
            .thenReturn(synthetic);

        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        CelestialBodyWrapperFactory factory =
            new CelestialBodyWrapperFactory(mockClient, cache);

        Frame frame = new personal.spacesim.simulation.frame.CustomFrameFactory()
            .createFrame(frameName);
        CelestialBodyWrapper moon =
            factory.createCelestialBodyWrapper("MIMAS", frame, date);

        PVCoordinates satInFrame = saturn.getPVCoordinates(date, frame);
        double posErr = moon.getPosition().subtract(satInFrame.getPosition()).getNorm();
        double velErr = moon.getVelocity().subtract(satInFrame.getVelocity()).getNorm();

        // Transform is exact; allow only float round-off.
        assertTrue(posErr < 1.0,
            frameName + ": Horizons body must co-locate with Orekit Saturn; "
                + "position error = " + posErr + " m (pre-fix this was ~5e11 m)");
        assertTrue(velErr < 1e-3,
            frameName + ": velocity must match too; error = " + velErr + " m/s");
        assertEquals("SATURN", moon.getOrbitingBody());
    }
}
