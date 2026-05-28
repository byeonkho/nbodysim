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
