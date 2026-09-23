package personal.spacesim.simulation.body.horizons;

import lombok.extern.slf4j.Slf4j;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.stream.Stream;

/**
 * Process-local cache for Horizons state-vector responses, keyed by
 * SPK ID + epoch. State vectors at any (body, epoch) are deterministic
 * from JPL's orbit fits — once fetched, no need to re-query.
 *
 * <p>Cache keys and fetch instants use the same nearest millisecond from J2000.
 * The tdb-v2 namespace excludes older entries fetched with ambiguous time scales.
 *
 * <p>Entries are also written through to {@code cacheDir} as one JSON file
 * per key. On construction the directory is scanned and existing entries
 * are loaded into memory, so a fresh JVM (e.g. after a Railway redeploy)
 * starts with a warm cache and avoids the refetch storm. Corrupt files
 * are logged and skipped — never block startup.
 *
 * <p>Lookup happens at sim-submit time (once per body), not per timestep,
 * so the disk + {@code ConcurrentHashMap} overhead is irrelevant to the
 * hot path.
 */
@Slf4j
@Component
public class HorizonsStateCache {

    private record Key(String spkId, long epochMillisFromJ2000) {}

    /**
     * Self-describing on-disk record. The filename embeds the key for inspection
     * and seed generation; the file body repeats both fields so every record can
     * be parsed independently when bundled as a precomputed seed.
     */
    record DiskEntry(
        String spkId,
        long epochMillis,
        double px, double py, double pz,
        double vx, double vy, double vz
    ) {
        static DiskEntry of(String spkId, long epochMillis, HorizonsResponseParser.State s) {
            return new DiskEntry(spkId, epochMillis,
                s.position().getX(), s.position().getY(), s.position().getZ(),
                s.velocity().getX(), s.velocity().getY(), s.velocity().getZ());
        }

        HorizonsResponseParser.State toState() {
            return new HorizonsResponseParser.State(
                new Vector3D(px, py, pz), new Vector3D(vx, vy, vz));
        }
    }

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final ConcurrentHashMap<Key, HorizonsResponseParser.State> store =
            new ConcurrentHashMap<>();
    private final Path cacheDir;

    public HorizonsStateCache(@Value("${spacesim.horizons.cacheDir:./horizons-cache}") Path cacheDir) {
        this.cacheDir = cacheDir.resolve("tdb-v2");
        seedFromClasspath();
        try {
            Files.createDirectories(this.cacheDir);
        } catch (IOException e) {
            // Can't create the cache dir — operate in pure in-memory mode.
            // Surfaces as a WARN so prod misconfiguration is visible without
            // crashing the app.
            log.warn("Horizons cache dir {} unavailable; running in-memory only: {}",
                cacheDir, e.toString());
            return;
        }
        loadFromDisk();
    }

    /**
     * Seed the in-memory store from prebaked entries shipped in the jar
     * (horizons-prebaked-v2/ on the classpath): the canonical-preset bodies at
     * the default epoch. Keeps default-epoch sims JPL-independent on a cold
     * cache (fresh container, wiped disk) with no volume required. Disk
     * entries loaded afterwards overwrite seeds harmlessly (deterministic
     * identical values).
     */
    private void seedFromClasspath() {
        try {
            Resource[] seeds = new PathMatchingResourcePatternResolver()
                    .getResources("classpath*:horizons-prebaked-v2/*.json");
            for (Resource seed : seeds) {
                try (InputStream in = seed.getInputStream()) {
                    DiskEntry entry = JSON.readValue(in, DiskEntry.class);
                    store.put(new Key(entry.spkId(), entry.epochMillis()), entry.toState());
                } catch (IOException | JacksonException e) {
                    log.warn("Skipping corrupt prebaked Horizons entry {}: {}",
                            seed, e.toString());
                }
            }
            if (seeds.length > 0) {
                log.info("Seeded {} prebaked Horizons entries from classpath", seeds.length);
            }
        } catch (IOException e) {
            log.warn("Failed to scan prebaked Horizons entries: {}", e.toString());
        }
    }

    private void loadFromDisk() {
        try (Stream<Path> entries = Files.list(cacheDir)) {
            entries
                .filter(p -> p.toString().endsWith(".json"))
                .forEach(this::loadOneEntry);
        } catch (IOException e) {
            log.warn("Failed to scan Horizons cache dir {}: {}", cacheDir, e.toString());
        }
        // store already holds the classpath seeds here, so report the in-memory
        // total rather than implying everything came from the disk dir.
        log.info("Horizons cache ready: {} entries in memory after scanning {}",
                store.size(), cacheDir);
    }

    private void loadOneEntry(Path file) {
        try {
            DiskEntry entry = JSON.readValue(file.toFile(), DiskEntry.class);
            Key key = new Key(entry.spkId(), entry.epochMillis());
            store.put(key, entry.toState());
        } catch (JacksonException e) {
            // Corrupt JSON, truncated write from a prior crash, schema drift —
            // any single bad file would otherwise prevent boot. Log and skip;
            // the next access for that key will re-fetch.
            log.warn("Skipping corrupt Horizons cache file {}: {}", file, e.toString());
        }
    }

    /**
     * Return cached state for (spkId, epoch), or compute it via the supplied
     * fetcher and cache the result (in memory + on disk). The fetcher receives
     * the canonical millisecond epoch.
     *
     * @throws NullPointerException if the fetcher returns null
     */
    public HorizonsResponseParser.State getOrFetch(
            String spkId,
            AbsoluteDate epoch,
            Function<AbsoluteDate, HorizonsResponseParser.State> fetcher
    ) {
        long millis = Math.round(epoch.durationFrom(AbsoluteDate.J2000_EPOCH) * 1000.0);
        AbsoluteDate canonicalEpoch = AbsoluteDate.J2000_EPOCH.shiftedBy(millis / 1000.0);
        Key k = new Key(spkId, millis);
        return store.computeIfAbsent(k, _key -> {
            HorizonsResponseParser.State state = Objects.requireNonNull(
                fetcher.apply(canonicalEpoch),
                "fetcher returned null state for " + spkId + " at " + epoch);
            writeToDisk(spkId, millis, state);
            return state;
        });
    }

    private void writeToDisk(String spkId, long epochMillis, HorizonsResponseParser.State state) {
        if (cacheDir == null) return;
        Path target = cacheDir.resolve(spkId + "_" + epochMillis + ".json");
        Path tmp = cacheDir.resolve(spkId + "_" + epochMillis + ".json.tmp");
        try {
            JSON.writeValue(tmp.toFile(), DiskEntry.of(spkId, epochMillis, state));
            // Atomic rename: prevents partial-write reads on a concurrent
            // load. Fall back to a non-atomic move if the filesystem refuses
            // ATOMIC_MOVE (e.g. across mount points).
            try {
                Files.move(tmp, target,
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ame) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException | JacksonException e) {
            // Disk write failure is not fatal — the in-memory cache still
            // serves the rest of this process; only future cold-start
            // efficiency is lost.
            log.warn("Failed to persist Horizons cache entry for {} @ {}ms: {}",
                spkId, epochMillis, e.toString());
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) { /* best-effort cleanup */ }
        }
    }

    public int size() { return store.size(); }
}
