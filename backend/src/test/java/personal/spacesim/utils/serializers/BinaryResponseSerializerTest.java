package personal.spacesim.utils.serializers;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScale;
import org.orekit.time.TimeScalesFactory;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Dp853Telemetry;
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

import java.util.HashMap;

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
        // Empty/null inputs serialise to a 19-byte header:
        //   version(1) + bodyCount(2) + dp853AvgStep(8) + dp853AcceptRate(4)
        //   + timestepCount(4) = 19
        // No start/gap/body sections are written when there are no timesteps.
        // DP853 telemetry fields are NaN-encoded when not applicable, kept
        // always-present so the parser can stay branchless.
        BinaryResponseSerializer ser = new BinaryResponseSerializer();
        byte[] empty = ser.serialize((ChunkResult) null, null);
        assertEquals(19, empty.length);
        ByteBuffer buf = ByteBuffer.wrap(empty).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(BinaryResponseSerializer.FORMAT_VERSION, buf.get() & 0xFF, "formatVersion");
        assertEquals(0, buf.getShort());
        assertTrue(Double.isNaN(buf.getDouble()), "avgStepSeconds must be NaN for empty data");
        assertTrue(Float.isNaN(buf.getFloat()),   "acceptRate must be NaN for empty data");
        assertEquals(0, buf.getInt());
    }

    @Test
    void serialisedBytesMatchDocumentedLayout() {
        // Construct a known input matching the frontend's parseBinaryChunk.test.ts
        // hand-crafted case (Earth + Moon at 2024-06-05T00:00:00Z). Read the
        // bytes back via ByteBuffer and verify each field — proves the
        // serializer's output matches the version-2 format spec character for
        // character (delta-encoded, structure-of-arrays).
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);
        long expectedMillis = date.toDate(utc).getTime();

        CelestialBodySnapshot earth = new CelestialBodySnapshot(
                "Earth",
                new Vector3D(1.0, 2.0, 3.0),
                new Vector3D(4.0, 5.0, 6.0)
        );
        CelestialBodySnapshot moon = new CelestialBodySnapshot(
                "Moon",
                new Vector3D(7.0, 8.0, 9.0),
                new Vector3D(10.0, 11.0, 12.0)
        );

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots = new LinkedHashMap<>();
        snapshots.put(date, List.of(earth, moon));

        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();
        deltaE.put(date, 1.5e-12);

        Dp853Telemetry telemetry = new Dp853Telemetry(3600.0, 0.94);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, telemetry);

        // Made-up µ values — the serializer just shuttles bytes; we only
        // need to confirm they round-trip through the header in the right
        // slot. Real values come from Orekit's CelestialBody.getGM() at
        // runtime via CelestialBodyWrapper.
        Map<String, Double> mu = new LinkedHashMap<>();
        mu.put("Earth", 3.986004418e14);
        mu.put("Moon", 4.9028000661e12);

        byte[] bytes = new BinaryResponseSerializer().serialize(chunk, mu);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        // Header
        assertEquals(BinaryResponseSerializer.FORMAT_VERSION, buf.get() & 0xFF, "formatVersion");
        assertEquals(2, buf.getShort(), "bodyCount");

        int earthLen = buf.getShort();
        assertEquals(5, earthLen);
        byte[] earthName = new byte[earthLen];
        buf.get(earthName);
        assertEquals("Earth", new String(earthName, StandardCharsets.UTF_8));
        assertEquals(3.986004418e14, buf.getDouble(), "Earth µ");

        int moonLen = buf.getShort();
        assertEquals(4, moonLen);
        byte[] moonName = new byte[moonLen];
        buf.get(moonName);
        assertEquals("Moon", new String(moonName, StandardCharsets.UTF_8));
        assertEquals(4.9028000661e12, buf.getDouble(), "Moon µ");

        // DP853 telemetry — fixture is the canonical pin shared with the
        // frontend parser test. If either side drifts, one fails first.
        assertEquals(3600.0, buf.getDouble(), 1e-12, "dp853AvgStepSeconds");
        assertEquals(0.94f, buf.getFloat(), 1e-6f, "dp853AcceptRate");

        assertEquals(1, buf.getInt(), "timestepCount");

        // Body section (version 2): start + gap, then planar fields.
        assertEquals(expectedMillis, buf.getLong(), "startMillis");
        assertEquals(0.0, buf.getDouble(), "gapMillis is 0 for a single timestep");

        // deltaERelative planar (float32; UI readout shown to 1-2 sig figs).
        assertEquals(1.5e-12f, buf.getFloat(), 1e-18f, "per-snapshot ΔE/E₀");

        // Per-body absolute reference (timestep 0), float64. Earth then Moon.
        assertEquals(1.0, buf.getDouble()); assertEquals(2.0, buf.getDouble()); assertEquals(3.0, buf.getDouble());
        assertEquals(7.0, buf.getDouble()); assertEquals(8.0, buf.getDouble()); assertEquals(9.0, buf.getDouble());

        // Position deltas, planar by axis (row 0 is all zeros — only one
        // timestep). 2 bodies × 3 axes = 6 zero floats.
        for (int i = 0; i < 6; i++) {
            assertEquals(0.0f, buf.getFloat(), "row-0 delta is zero");
        }

        // Velocity, planar by axis (vx for [Earth, Moon], then vy, then vz),
        // float32 (precision-loss path damps by ~5 orders before anything
        // visible — it's the Hermite tangent client-side).
        assertEquals(4.0f, buf.getFloat());  assertEquals(10.0f, buf.getFloat()); // vx
        assertEquals(5.0f, buf.getFloat());  assertEquals(11.0f, buf.getFloat()); // vy
        assertEquals(6.0f, buf.getFloat());  assertEquals(12.0f, buf.getFloat()); // vz

        // Buffer should be exactly consumed
        assertEquals(0, buf.remaining(), "no trailing bytes");
    }

    @Test
    void temporalDeltasReconstructAbsolutePositions() {
        // Two timesteps so the delta path is exercised: row 0 is the reference,
        // row 1 carries per-step deltas that must sum back to the absolute
        // position. Pins the version-2 delta semantics on the Java side.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate t0 = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);
        AbsoluteDate t1 = new AbsoluteDate(2024, 6, 6, 0, 0, 0.0, utc);

        CelestialBodySnapshot earth0 = new CelestialBodySnapshot(
                "Earth", new Vector3D(1.0, 2.0, 3.0), new Vector3D(4.0, 5.0, 6.0));
        CelestialBodySnapshot earth1 = new CelestialBodySnapshot(
                "Earth", new Vector3D(13.0, 14.0, 15.0), new Vector3D(16.0, 17.0, 18.0));

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots = new LinkedHashMap<>();
        snapshots.put(t0, List.of(earth0));
        snapshots.put(t1, List.of(earth1));
        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();
        deltaE.put(t0, 0.0);
        deltaE.put(t1, 0.0);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, null);

        Map<String, Double> mu = Collections.singletonMap("Earth", 3.986004418e14);
        byte[] bytes = new BinaryResponseSerializer().serialize(chunk, mu);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        buf.get();                                  // version
        buf.getShort();                             // bodyCount
        int nameLen = buf.getShort();
        buf.position(buf.position() + nameLen);     // skip name
        buf.getDouble();                            // mu
        buf.getDouble();                            // dp853 avg (NaN)
        buf.getFloat();                             // dp853 rate (NaN)
        assertEquals(2, buf.getInt(), "timestepCount");

        long startMillis = buf.getLong();
        double gapMillis = buf.getDouble();
        assertEquals(t0.toDate(utc).getTime(), startMillis, "startMillis");
        assertEquals((double) (t1.toDate(utc).getTime() - startMillis), gapMillis, 1e-6,
                "gapMillis = one day for two daily timesteps");

        buf.getFloat(); buf.getFloat();             // deltaE planar (2 timesteps)

        // Reference (timestep 0) for Earth.
        assertEquals(1.0, buf.getDouble()); assertEquals(2.0, buf.getDouble()); assertEquals(3.0, buf.getDouble());

        // Deltas planar by axis: x → [row0=0, row1=13-1=12], y → [0, 14-2=12],
        // z → [0, 15-3=12].
        assertEquals(0.0f, buf.getFloat());  assertEquals(12.0f, buf.getFloat()); // x
        assertEquals(0.0f, buf.getFloat());  assertEquals(12.0f, buf.getFloat()); // y
        assertEquals(0.0f, buf.getFloat());  assertEquals(12.0f, buf.getFloat()); // z
    }

    @Test
    void fixedStepIntegratorWritesNaNTelemetry() {
        // ChunkResult.telemetry() == null → header DP853 fields encoded
        // as NaN. Parser branchlessly maps NaN → null for the
        // chunk-level fields downstream.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots = new LinkedHashMap<>();
        snapshots.put(date, List.of(new CelestialBodySnapshot(
                "Earth",
                new Vector3D(0.0, 0.0, 0.0),
                new Vector3D(0.0, 0.0, 0.0))));
        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();
        deltaE.put(date, 0.0);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, null);

        Map<String, Double> mu = new HashMap<>();
        mu.put("Earth", 3.986004418e14);

        byte[] bytes = new BinaryResponseSerializer().serialize(chunk, mu);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        buf.get();                               // version
        buf.getShort();                          // bodyCount
        int nameLen = buf.getShort();
        buf.position(buf.position() + nameLen);  // skip name bytes
        buf.getDouble();                         // mu

        assertTrue(Double.isNaN(buf.getDouble()), "avgStepSeconds must be NaN for non-DP853");
        assertTrue(Float.isNaN(buf.getFloat()),   "acceptRate must be NaN for non-DP853");
    }

    @Test
    void missingMuEntryFallsThroughToZero() {
        // The serializer shouldn't crash if the µ map is missing a body.
        // Frontend treats µ=0 as "unknown" and skips Keplerian rendering for
        // that body — far better failure mode than NaN/inf cascades.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 1, 1, 0, 0, 0.0, utc);

        CelestialBodySnapshot body = new CelestialBodySnapshot(
                "Earth", new Vector3D(1.0, 2.0, 3.0), new Vector3D(4.0, 5.0, 6.0)
        );
        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots =
                Collections.singletonMap(date, List.of(body));
        Map<AbsoluteDate, Double> deltaE = Collections.singletonMap(date, 0.0);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, null);

        // Empty µ map — no entry for Earth.
        byte[] bytes = new BinaryResponseSerializer()
                .serialize(chunk, Collections.emptyMap());
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        buf.get();                              // version
        assertEquals(1, buf.getShort()); // bodyCount
        int nameLen = buf.getShort();
        buf.position(buf.position() + nameLen); // skip name bytes
        assertEquals(0.0, buf.getDouble(), "missing µ falls through to 0.0");
    }

    @Test
    void multiByteUtf8NamesUseByteLengthNotCharLength() {
        // "Α" (Greek capital alpha) is 2 bytes in UTF-8 but 1 character.
        // The serializer must write nameLength=2, otherwise the frontend
        // parser reads the wrong number of bytes and corrupts every
        // subsequent field. Edge case worth pinning.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 1, 1, 0, 0, 0.0, utc);

        CelestialBodySnapshot body = new CelestialBodySnapshot("Α", Vector3D.ZERO, Vector3D.ZERO);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots =
                Collections.singletonMap(date, List.of(body));
        Map<AbsoluteDate, Double> deltaE = Collections.singletonMap(date, 0.0);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, null);

        Map<String, Double> mu = Collections.singletonMap("Α", 1.0);
        byte[] bytes = new BinaryResponseSerializer().serialize(chunk, mu);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        buf.get();                       // version
        assertEquals(1, buf.getShort()); // bodyCount
        assertEquals(2, buf.getShort(), "nameLength must be UTF-8 byte count");
    }
}
