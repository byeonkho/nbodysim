package personal.spacesim.utils.serializers;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScale;
import org.orekit.time.TimeScalesFactory;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins the on-the-wire binary layout. The frontend has a mirror test
 * (parseBinaryChunk.test.ts) that hand-crafts the same byte structure;
 * if either side drifts from the spec, one of the two tests fails first.
 */
class BinaryResponseSerializerTest {

    static {
        // Orekit needs its data directory on the classpath. The integrator
        // tests don't load Orekit; this one does (because AbsoluteDate keys
        // need a UTC scale to convert to millis).
        try {
            URL url = BinaryResponseSerializerTest.class.getClassLoader()
                    .getResource("orekit-data-master");
            if (url != null) {
                Path path = Paths.get(url.toURI());
                org.orekit.data.DataContext.getDefault().getDataProvidersManager()
                        .addProvider(new org.orekit.data.DirectoryCrawler(path.toFile()));
            }
        } catch (URISyntaxException e) {
            throw new UncheckedIOException(new IOException(e));
        }
    }

    @Test
    void emptyDataProducesHeaderOnly() {
        // Empty/null inputs serialise to a 6-byte header: bodyCount=0, timestepCount=0.
        // No per-body section, no per-timestep section.
        BinaryResponseSerializer ser = new BinaryResponseSerializer();
        byte[] empty = ser.serialize(null);
        assertEquals(6, empty.length);
        ByteBuffer buf = ByteBuffer.wrap(empty).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(0, buf.getShort());
        assertEquals(0, buf.getInt());
    }

    @Test
    void serialisedBytesMatchDocumentedLayout() {
        // Construct a known input matching the frontend's parseBinaryChunk.test.ts
        // hand-crafted case (Earth + Moon at 2024-06-05T00:00:00Z). Read the
        // bytes back via ByteBuffer and verify each field — proves the
        // serializer's output matches the format spec character for character.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);
        long expectedMillis = date.toDate(utc).getTime();

        CelestialBodySnapshot earth = new CelestialBodySnapshot();
        earth.setName("Earth");
        earth.setPosition(new Vector3D(1.0, 2.0, 3.0));
        earth.setVelocity(new Vector3D(4.0, 5.0, 6.0));

        CelestialBodySnapshot moon = new CelestialBodySnapshot();
        moon.setName("Moon");
        moon.setPosition(new Vector3D(7.0, 8.0, 9.0));
        moon.setVelocity(new Vector3D(10.0, 11.0, 12.0));

        Map<AbsoluteDate, List<CelestialBodySnapshot>> data = new LinkedHashMap<>();
        data.put(date, List.of(earth, moon));

        byte[] bytes = new BinaryResponseSerializer().serialize(data);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        // Header
        assertEquals(2, buf.getShort(), "bodyCount");

        int earthLen = buf.getShort();
        assertEquals(5, earthLen);
        byte[] earthName = new byte[earthLen];
        buf.get(earthName);
        assertEquals("Earth", new String(earthName, StandardCharsets.UTF_8));

        int moonLen = buf.getShort();
        assertEquals(4, moonLen);
        byte[] moonName = new byte[moonLen];
        buf.get(moonName);
        assertEquals("Moon", new String(moonName, StandardCharsets.UTF_8));

        assertEquals(1, buf.getInt(), "timestepCount");

        // Per-timestep
        assertEquals(expectedMillis, buf.getLong(), "timestamp millis");
        // Earth
        assertEquals(1.0, buf.getDouble()); assertEquals(2.0, buf.getDouble()); assertEquals(3.0, buf.getDouble());
        assertEquals(4.0, buf.getDouble()); assertEquals(5.0, buf.getDouble()); assertEquals(6.0, buf.getDouble());
        // Moon
        assertEquals(7.0, buf.getDouble()); assertEquals(8.0, buf.getDouble()); assertEquals(9.0, buf.getDouble());
        assertEquals(10.0, buf.getDouble()); assertEquals(11.0, buf.getDouble()); assertEquals(12.0, buf.getDouble());

        // Buffer should be exactly consumed
        assertEquals(0, buf.remaining(), "no trailing bytes");
    }

    @Test
    void multiByteUtf8NamesUseByteLengthNotCharLength() {
        // "Α" (Greek capital alpha) is 2 bytes in UTF-8 but 1 character.
        // The serializer must write nameLength=2, otherwise the frontend
        // parser reads the wrong number of bytes and corrupts every
        // subsequent field. Edge case worth pinning.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 1, 1, 0, 0, 0.0, utc);

        CelestialBodySnapshot body = new CelestialBodySnapshot();
        body.setName("Α");
        body.setPosition(Vector3D.ZERO);
        body.setVelocity(Vector3D.ZERO);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> data =
                Collections.singletonMap(date, List.of(body));

        byte[] bytes = new BinaryResponseSerializer().serialize(data);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        assertEquals(1, buf.getShort()); // bodyCount
        assertEquals(2, buf.getShort(), "nameLength must be UTF-8 byte count");
    }
}
