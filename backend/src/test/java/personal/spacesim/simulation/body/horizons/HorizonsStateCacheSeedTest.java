package personal.spacesim.simulation.body.horizons;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.orekit.time.AbsoluteDate;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the classpath seed path: a fresh cache (empty disk dir) must already
 * contain the prebaked default-epoch states and serve them without invoking
 * the fetcher. A silently broken seed path would reintroduce the JPL fetch
 * storm on the first canonical-preset run after every redeploy, with no
 * other signal.
 */
class HorizonsStateCacheSeedTest {

    @TempDir
    Path emptyCacheDir;

    @Test
    void seedsPrebakedEntriesFromClasspath() throws Exception {
        HorizonsStateCache cache = new HorizonsStateCache(emptyCacheDir);

        // All 29 Horizons-sourced catalog bodies at the default epoch.
        assertTrue(cache.size() >= 29,
                "expected >= 29 prebaked entries, got " + cache.size());

        // Any one seed resolves without the fetcher being called.
        Resource[] seeds = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:horizons-prebaked/*.json");
        assertTrue(seeds.length >= 29, "expected >= 29 seed files on the classpath");
        String name = seeds[0].getFilename();
        String[] parts = name.substring(0, name.length() - ".json".length()).split("_");
        String spkId = parts[0];
        double epochSeconds = Double.parseDouble(parts[1]);

        HorizonsResponseParser.State state = cache.getOrFetch(
                spkId,
                AbsoluteDate.J2000_EPOCH.shiftedBy(epochSeconds),
                d -> {
                    throw new AssertionError("fetcher must not run for a seeded key");
                });
        assertNotNull(state);
    }
}
