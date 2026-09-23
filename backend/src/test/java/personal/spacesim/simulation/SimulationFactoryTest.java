package personal.spacesim.simulation;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.body.CelestialBodyWrapperFactory;
import personal.spacesim.simulation.body.horizons.HorizonsClient;
import personal.spacesim.simulation.body.horizons.HorizonsResponseParser;
import personal.spacesim.simulation.body.horizons.HorizonsStateCache;
import personal.spacesim.simulation.frame.CustomFrameFactory;
import personal.spacesim.utils.math.integrators.IntegratorFactory;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Pins {@code SimulationFactory.createSimulation}'s body-ordering contract:
 * test particles are sorted to the end of the body list so the integrator's
 * {@code massiveCount} dispatch can do
 * {@code sumBound = massiveCount} cleanly.
 */
class SimulationFactoryTest {

    @TempDir
    Path horizonsCacheDir;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationFactoryTest.class.getClassLoader()
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

    private SimulationFactory newFactory() {
        // Mock HorizonsClient so we never make a real HTTP call. Return a
        // canned state for any minor-body fetch — the actual numbers don't
        // matter for ordering tests, only that the call returns a wrapper.
        HorizonsClient mockClient = mock(HorizonsClient.class);
        when(mockClient.fetchByDesignation(anyString(), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2.0e11, 1.0e11, 1.0e10),
                new Vector3D(1.0e4,  1.0e4,  0.0)));
        when(mockClient.fetchByMajorBodyId(anyString(), any(AbsoluteDate.class)))
            .thenReturn(new HorizonsResponseParser.State(
                new Vector3D(2.0e11, 1.0e11, 1.0e10),
                new Vector3D(1.0e4,  1.0e4,  0.0)));

        return new SimulationFactory(
            new IntegratorFactory(),
            new CelestialBodyWrapperFactory(mockClient, new HorizonsStateCache(horizonsCacheDir)),
            new CustomFrameFactory()
        );
    }

    @Test
    void plutoCharonDefaultSeedMatchesIndependentUtcFixtures() throws Exception {
        AbsoluteDate epoch = new AbsoluteDate("2024-06-05T00:00:00.000", org.orekit.time.TimeScalesFactory.getUTC());
        java.util.function.Function<String, HorizonsResponseParser.State> fixture = name -> {
            try {
                return HorizonsResponseParser.parseFirstRecord(java.nio.file.Files.readString(
                        new org.springframework.core.io.ClassPathResource("horizons/" + name + ".txt").getFile().toPath()));
            } catch (IOException e) { throw new UncheckedIOException(e); }
        };
        HorizonsStateCache cache = new HorizonsStateCache(horizonsCacheDir);
        HorizonsResponseParser.State charon = cache.getOrFetch("901", epoch, d -> {
            throw new AssertionError("default epoch must use the corrected seed");
        });
        assertEquals(0, charon.position().distance(fixture.apply("charon-ut").position()), 1.0);
        Simulation sim = newFactory().createSimulation("pluto", List.of("PLUTO", "CHARON"),
                "ICRF", "RK4", epoch, "hours", 1, 100);
        CelestialBodyWrapper pluto = sim.getCelestialBodies().get(0);
        Vector3D center = fixture.apply("pluto-center-ut").position();
        Vector3D barycenter = fixture.apply("pluto-barycenter-ut").position();
        assertTrue(center.distance(barycenter) > 2_000_000);
        // Rounded catalog GM and omitted small moons limit the physical-center
        // approximation. It should remove the original ~2131 km displacement.
        Vector3D residual = pluto.getPosition().subtract(org.orekit.bodies.CelestialBodyFactory.getSun()
                .getPVCoordinates(epoch, org.orekit.frames.FramesFactory.getICRF()).getPosition());
        assertTrue(residual.distance(center) < 5_000,
                "residual parent offset from independent Pluto center: " + residual.distance(center) + " m");
        assertEquals(List.of("PLUTO", "CHARON"), pluto.getReferenceBodyNames());
    }

    @Test
    void splittingMassiveMoonsPreservesSystemGmBarycenterAndMomentum() {
        for (List<String> system : List.of(
                List.of("JUPITER", "IO", "EUROPA", "GANYMEDE", "CALLISTO"),
                List.of("SATURN", "TITAN"), List.of("NEPTUNE", "TRITON"),
                List.of("PLUTO", "CHARON"), List.of("JUPITER", "IO"))) {
            SimulationFactory factory = newFactory();
            CelestialBodyWrapper original = factory.createSimulation("whole", List.of(system.get(0)),
                    "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH, "hours", 1, 100).getCelestialBodies().get(0);
            List<CelestialBodyWrapper> split = factory.createSimulation("split", system,
                    "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH, "hours", 1, 100).getCelestialBodies();
            double totalMu = split.stream().mapToDouble(CelestialBodyWrapper::getMu).sum();
            assertEquals(original.getMu(), totalMu, original.getMu() * 1e-15);
            Vector3D position = Vector3D.ZERO;
            Vector3D velocity = Vector3D.ZERO;
            for (CelestialBodyWrapper body : split) {
                position = position.add(body.getMu() / totalMu, body.getPosition());
                velocity = velocity.add(body.getMu() / totalMu, body.getVelocity());
            }
            assertEquals(0, position.distance(original.getPosition()), 0.003);
            assertEquals(0, velocity.distance(original.getVelocity()), 1e-10);
        }
    }

    @Test
    void testParticleMoonsDoNotSubtractMassAndEarthIsAlreadySeparate() {
        for (List<String> system : List.of(List.of("MARS", "PHOBOS", "DEIMOS"), List.of("EARTH", "MOON"))) {
            SimulationFactory factory = newFactory();
            CelestialBodyWrapper original = factory.createSimulation("whole", List.of(system.get(0)),
                    "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH, "hours", 1, 100).getCelestialBodies().get(0);
            CelestialBodyWrapper split = factory.createSimulation("split", system,
                    "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH, "hours", 1, 100).getCelestialBodies().get(0);
            assertEquals(original.getMu(), split.getMu());
            assertEquals(original.getPosition(), split.getPosition());
        }
    }

    @Test
    void onlyMajorPlanets_massiveCountEqualsTotal() {
        SimulationFactory factory = newFactory();
        Simulation sim = factory.createSimulation(
            "test", List.of("SUN", "EARTH", "MARS"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);
        assertEquals(3, sim.getCelestialBodies().size());
        assertEquals(3, sim.getMassiveCount());
    }

    @Test
    void testParticlesSortToEnd() {
        SimulationFactory factory = newFactory();
        // Mix of major planets, dwarf planet (Ceres = massive), and NEAs
        // (Eros + Apophis = test particles). Submission order interleaved.
        Simulation sim = factory.createSimulation(
            "test", List.of("SUN", "EROS", "EARTH", "CERES", "MARS", "APOPHIS"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);

        List<CelestialBodyWrapper> bodies = sim.getCelestialBodies();
        assertEquals(6, bodies.size());
        assertEquals(4, sim.getMassiveCount(),
            "SUN + EARTH + CERES + MARS are massive");

        // Massive prefix (any order): SUN, EARTH, CERES, MARS
        // Test suffix (any order): EROS, APOPHIS
        for (int i = 0; i < 4; i++) {
            String n = bodies.get(i).getName();
            assertTrue(
                n.equals("SUN") || n.equals("EARTH") ||
                n.equals("CERES") || n.equals("MARS"),
                "Massive prefix slot " + i + " was " + n);
        }
        for (int i = 4; i < 6; i++) {
            String n = bodies.get(i).getName();
            assertTrue(n.equals("EROS") || n.equals("APOPHIS"),
                "Test suffix slot " + i + " was " + n);
        }
    }

    @Test
    void plutoIsMassive_notTestParticle() {
        // PLUTO is in MinorBodyCatalog but flagged isTestParticle()=false.
        // It must end up in the massive prefix.
        SimulationFactory factory = newFactory();
        Simulation sim = factory.createSimulation(
            "test", List.of("SUN", "EROS", "PLUTO"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);

        assertEquals(3, sim.getCelestialBodies().size());
        assertEquals(2, sim.getMassiveCount(), "SUN + PLUTO are massive");

        List<String> names = sim.getCelestialBodies().stream()
            .map(CelestialBodyWrapper::getName).toList();
        assertEquals("EROS", names.get(2), "EROS must be last (test particle)");
    }

    @Test
    void allTestParticles_massiveCountZero() {
        // Edge case: only test particles. massiveCount = 0; the integrator's
        // inner loop will sum over an empty massive prefix and produce zero
        // acceleration. Mathematically valid even if physically uninteresting.
        SimulationFactory factory = newFactory();
        Simulation sim = factory.createSimulation(
            "test", List.of("EROS", "APOPHIS"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);

        assertEquals(0, sim.getMassiveCount());
    }

    @Test
    void galileansAreMassive_smallerSaturnMoonsAreTestParticles() {
        SimulationFactory factory = newFactory();
        // Mix: planets + Galileans (all massive) + Mimas/Enceladus (test
        // particles). Test-particle moons must sort to the end alongside
        // EROS-class test particles, leaving massiveCount = 3 planets + 4
        // Galileans = 7.
        Simulation sim = factory.createSimulation(
            "test",
            List.of("SUN", "EARTH", "MARS", "IO", "MIMAS", "EUROPA", "ENCELADUS",
                    "GANYMEDE", "CALLISTO"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);
        assertEquals(9, sim.getCelestialBodies().size());
        // 7 massive: SUN, EARTH, MARS, IO, EUROPA, GANYMEDE, CALLISTO
        assertEquals(7, sim.getMassiveCount());
        // Last two slots must be the test particles (order within each
        // partition is otherwise unconstrained — verify via the names).
        List<String> tailNames = sim.getCelestialBodies()
            .subList(7, 9).stream()
            .map(CelestialBodyWrapper::getName).toList();
        assertTrue(tailNames.contains("MIMAS"));
        assertTrue(tailNames.contains("ENCELADUS"));
    }

    @Test
    void dp853WithSingleSnapshotThrows() {
        // N <= 1 on the adaptive (DP853) path leaves the emission time-gap at
        // zero, which would make run()'s substep emit loop spin forever. The
        // constructor must reject it fast and clearly instead of hanging.
        SimulationFactory factory = newFactory();
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> factory.createSimulation(
                        "test", List.of("SUN", "EARTH"),
                        "Heliocentric", "DP853", AbsoluteDate.J2000_EPOCH,
                        "hours", 1, /* N */ 1));
        assertTrue(ex.getMessage().contains("targetSnapshotsPerChunk"),
                "Message should name the offending parameter: " + ex.getMessage());
    }

    @Test
    void dp853WithTwoSnapshotsConstructs() {
        // N = 2 is the minimum valid count for the adaptive path (one time gap
        // spanning the two samples), so construction must succeed.
        SimulationFactory factory = newFactory();
        Simulation sim = factory.createSimulation(
                "test", List.of("SUN", "EARTH"),
                "Heliocentric", "DP853", AbsoluteDate.J2000_EPOCH,
                "hours", 1, /* N */ 2);
        assertNotNull(sim);
        assertEquals(2, sim.getCelestialBodies().size());
    }

    @Test
    void titanMassive_iapetusTestParticle() {
        SimulationFactory factory = newFactory();
        Simulation sim = factory.createSimulation(
            "test",
            List.of("SUN", "SATURN", "TITAN", "IAPETUS"),
            "Heliocentric", "RK4", AbsoluteDate.J2000_EPOCH,
            "hours", 1, 5000);
        assertEquals(3, sim.getMassiveCount());  // SUN, SATURN, TITAN
        assertEquals("IAPETUS", sim.getCelestialBodies().get(3).getName());
    }
}
