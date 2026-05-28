package personal.spacesim.simulation.body.horizons;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.orekit.time.AbsoluteDate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

class HorizonsStateCacheTest {

    @Test
    void cachesPerSpkIdAndEpoch(@TempDir Path cacheDir) {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;

        HorizonsResponseParser.State s1 = cache.getOrFetch("2000433", j2000, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(
                new Vector3D(1, 2, 3), new Vector3D(4, 5, 6));
        });

        HorizonsResponseParser.State s2 = cache.getOrFetch("2000433", j2000, k -> {
            calls.incrementAndGet();
            fail("Second fetch must come from cache");
            return null;
        });

        assertEquals(1, calls.get(), "Second call must hit cache");
        assertEquals(s1.position().getX(), s2.position().getX());
        assertEquals(1, cache.size());
    }

    @Test
    void differentSpkIdsAreCachedSeparately(@TempDir Path cacheDir) {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;

        cache.getOrFetch("2000433", j2000, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(Vector3D.ZERO, Vector3D.ZERO);
        });
        cache.getOrFetch("2000001", j2000, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(Vector3D.ZERO, Vector3D.ZERO);
        });

        assertEquals(2, calls.get());
        assertEquals(2, cache.size());
    }

    @Test
    void differentEpochsAreCachedSeparately(@TempDir Path cacheDir) {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        AbsoluteDate jOther = j2000.shiftedBy(86400.0);  // +1 day

        cache.getOrFetch("2000433", j2000, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(Vector3D.ZERO, Vector3D.ZERO);
        });
        cache.getOrFetch("2000433", jOther, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(Vector3D.ZERO, Vector3D.ZERO);
        });

        assertEquals(2, calls.get());
        assertEquals(2, cache.size());
    }

    @Test
    void fetcherReturningNullThrows(@TempDir Path cacheDir) {
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        assertThrows(NullPointerException.class,
            () -> cache.getOrFetch("2000433", j2000, k -> null));
    }

    @Test
    void writesEntryToDiskAfterFetch(@TempDir Path cacheDir) throws Exception {
        // Disk persistence is the whole point of 65b — verify that a
        // successful fetch leaves a file behind that the next process
        // can load.
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;

        cache.getOrFetch("2000433", j2000, k ->
            new HorizonsResponseParser.State(
                new Vector3D(1.5e11, 2.5e10, 3.5e9),
                new Vector3D(4.0e4, 5.0e3, 6.0e2)));

        try (Stream<Path> files = Files.list(cacheDir)) {
            long jsonCount = files.filter(p -> p.toString().endsWith(".json")).count();
            assertEquals(1, jsonCount,
                "Expected exactly 1 cache file in " + cacheDir);
        }
        // Filename should embed the key for human inspection + seed-bakeability.
        Path expected = cacheDir.resolve("2000433_0.json");
        assertTrue(Files.exists(expected),
            "Expected cache file at " + expected + "; listing: "
                + Files.list(cacheDir).toList());
    }

    @Test
    void loadsExistingEntriesFromDiskOnConstruction(@TempDir Path cacheDir)
            throws Exception {
        // Pre-seed: a previous process wrote a cache file for this key.
        // The new process must serve from disk without invoking the fetcher
        // — eliminating the refetch storm on Fly redeploys.
        Files.writeString(cacheDir.resolve("2000433_0.json"),
            "{\"spkId\":\"2000433\",\"epochSeconds\":0,"
                + "\"px\":1.0e11,\"py\":2.0e11,\"pz\":3.0e11,"
                + "\"vx\":1.0e4,\"vy\":2.0e4,\"vz\":3.0e4}");

        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);
        AtomicInteger fetcherCalls = new AtomicInteger();

        HorizonsResponseParser.State state = cache.getOrFetch(
            "2000433", AbsoluteDate.J2000_EPOCH, k -> {
                fetcherCalls.incrementAndGet();
                fail("Disk-loaded entry must serve without fetcher");
                return null;
            });

        assertEquals(0, fetcherCalls.get(),
            "Fetcher must not be invoked for disk-loaded entry");
        assertEquals(1.0e11, state.position().getX(), 1e-3);
        assertEquals(3.0e4, state.velocity().getZ(), 1e-3);
    }

    @Test
    void corruptFileIsSkippedOnLoad(@TempDir Path cacheDir) throws Exception {
        // A single corrupt file (truncated write, JSON-incompatible content,
        // schema drift from an older format) must not prevent boot. Skip
        // the entry; the next access for that key just re-fetches.
        Files.writeString(cacheDir.resolve("2000433_0.json"), "{not valid json");
        // Valid file alongside to confirm the loader keeps going.
        Files.writeString(cacheDir.resolve("2000001_0.json"),
            "{\"spkId\":\"2000001\",\"epochSeconds\":0,"
                + "\"px\":1.0,\"py\":2.0,\"pz\":3.0,"
                + "\"vx\":4.0,\"vy\":5.0,\"vz\":6.0}");

        // Construction must not throw.
        HorizonsStateCache cache = new HorizonsStateCache(cacheDir);

        // Valid file is loaded.
        AtomicInteger calls = new AtomicInteger();
        cache.getOrFetch("2000001", AbsoluteDate.J2000_EPOCH, k -> {
            calls.incrementAndGet();
            return new HorizonsResponseParser.State(Vector3D.ZERO, Vector3D.ZERO);
        });
        assertEquals(0, calls.get(),
            "Valid entry alongside the corrupt one must still load");
    }
}
