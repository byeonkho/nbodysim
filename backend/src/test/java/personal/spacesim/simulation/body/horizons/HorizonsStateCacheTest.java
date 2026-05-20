package personal.spacesim.simulation.body.horizons;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;
import org.orekit.time.AbsoluteDate;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class HorizonsStateCacheTest {

    @Test
    void cachesPerSpkIdAndEpoch() {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache();
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
    void differentSpkIdsAreCachedSeparately() {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache();
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
    void differentEpochsAreCachedSeparately() {
        AtomicInteger calls = new AtomicInteger();
        HorizonsStateCache cache = new HorizonsStateCache();
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
    void fetcherReturningNullThrows() {
        HorizonsStateCache cache = new HorizonsStateCache();
        AbsoluteDate j2000 = AbsoluteDate.J2000_EPOCH;
        assertThrows(NullPointerException.class,
            () -> cache.getOrFetch("2000433", j2000, k -> null));
    }
}
