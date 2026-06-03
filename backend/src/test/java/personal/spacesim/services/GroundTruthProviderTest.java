package personal.spacesim.services;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.orekit.bodies.CelestialBodyFactory;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.frames.Frame;
import org.orekit.frames.FramesFactory;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.orekit.utils.PVCoordinates;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import personal.spacesim.dtos.BodyGroundTruthTrack;
import personal.spacesim.dtos.GroundTruthAnchor;
import personal.spacesim.dtos.GroundTruthResponse;
import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(SpringExtension.class)
@SpringBootTest
class GroundTruthProviderTest {

    @Autowired
    private GroundTruthProvider provider;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = GroundTruthProviderTest.class.getClassLoader()
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
    void samplesSupportedBodySunRelativeAtDailyCadence() {
        Frame frame = FramesFactory.getICRF();
        AbsoluteDate from = new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        AbsoluteDate to = from.shiftedBy(10 * 86_400.0); // 10 days

        CelestialBodyWrapper earth = new CelestialBodyWrapper("EARTH", frame, from);
        earth.setOrbitingBody("SUN");

        GroundTruthResponse resp = provider.sampleTracks(List.of(earth), frame, from, to);

        assertEquals(1, resp.tracks().size());
        BodyGroundTruthTrack track = resp.tracks().get(0);
        assertEquals("EARTH", track.name());
        // i = 0..10 inclusive at 1-day cadence over a 10-day window.
        assertEquals(11, track.anchors().size());

        // First anchor's Sun-relative position equals direct Orekit at `from`.
        PVCoordinates bodyPv = CelestialBodyFactory.getBody("EARTH").getPVCoordinates(from, frame);
        PVCoordinates sunPv = CelestialBodyFactory.getSun().getPVCoordinates(from, frame);
        Vector3D expected = bodyPv.getPosition().subtract(sunPv.getPosition());

        GroundTruthAnchor a0 = track.anchors().get(0);
        assertEquals(expected.getX(), a0.position()[0], 1.0); // 1 metre tolerance
        assertEquals(expected.getY(), a0.position()[1], 1.0);
        assertEquals(expected.getZ(), a0.position()[2], 1.0);
        assertEquals(from.toDate(TimeScalesFactory.getUTC()).getTime(), a0.epochMillis());
    }

    @Test
    void omitsUnsupportedBodies() {
        Frame frame = FramesFactory.getICRF();
        AbsoluteDate from = new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        AbsoluteDate to = from.shiftedBy(86_400.0);

        // Earth's Moon orbits EARTH, so it is not a supported (Sun-relative,
        // planet/Pluto) body in v1.
        CelestialBodyWrapper moon = new CelestialBodyWrapper("MOON", frame, from);
        moon.setOrbitingBody("EARTH");

        GroundTruthResponse resp = provider.sampleTracks(List.of(moon), frame, from, to);
        assertTrue(resp.tracks().isEmpty());
    }
}
