package personal.spacesim.simulation.body.horizons;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
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
 * <p>Cache key uses epoch durations from J2000 truncated to whole seconds.
 * Horizons resolution is per-minute at best for small-body queries; sub-second
 * key collisions are physically impossible at our chunk scale.
 *
 * <p>Entries are also written through to {@code cacheDir} as one JSON file
 * per key. On construction the directory is scanned and existing entries
 * are loaded into memory, so a fresh JVM (e.g. after a Fly.io redeploy)
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

    private record Key(String spkId, long epochSecondsFromJ2000) {}

    /**
     * Self-describing on-disk record. Filename embeds the key for human
     * inspection and seed-bakeability; the file body repeats both fields
     * so each file is independently parseable (useful when shipping
     * prebaked entries — see todo #65c).
     */
    record DiskEntry(
        String spkId,
        long epochSeconds,
        double px, double py, double pz,
        double vx, double vy, double vz
    ) {
        static DiskEntry of(String spkId, long epochSeconds, HorizonsResponseParser.State s) {
            return new DiskEntry(spkId, epochSeconds,
                s.position().getX(), s.position().getY(), s.position().getZ(),
                s.velocity().getX(), s.velocity().getY(), s.velocity().getZ());
        }

        HorizonsResponseParser.State toState() {
            return new HorizonsResponseParser.State(
                new Vector3D(px, py, pz), new Vector3D(vx, vy, vz));
        }
    }

    private static final ObjectMapper JSON = new ObjectMapper();

    private final ConcurrentHashMap<Key, HorizonsResponseParser.State> store =
            new ConcurrentHashMap<>();
    private final Path cacheDir;

    public HorizonsStateCache(@Value("${spacesim.horizons.cacheDir:./horizons-cache}") Path cacheDir) {
        this.cacheDir = cacheDir;
        try {
            Files.createDirectories(cacheDir);
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

    private void loadFromDisk() {
        try (Stream<Path> entries = Files.list(cacheDir)) {
            entries
                .filter(p -> p.toString().endsWith(".json"))
                .forEach(this::loadOneEntry);
        } catch (IOException e) {
            log.warn("Failed to scan Horizons cache dir {}: {}", cacheDir, e.toString());
        }
        log.info("Loaded {} Horizons cache entries from {}", store.size(), cacheDir);
    }

    private void loadOneEntry(Path file) {
        try {
            DiskEntry entry = JSON.readValue(file.toFile(), DiskEntry.class);
            Key key = new Key(entry.spkId(), entry.epochSeconds());
            store.put(key, entry.toState());
        } catch (IOException e) {
            // Corrupt JSON, truncated write from a prior crash, schema drift —
            // any single bad file would otherwise prevent boot. Log and skip;
            // the next access for that key will re-fetch.
            log.warn("Skipping corrupt Horizons cache file {}: {}", file, e.toString());
        }
    }

    /**
     * Return cached state for (spkId, epoch), or compute it via the supplied
     * fetcher and cache the result (in memory + on disk). The fetcher receives
     * the requested epoch.
     *
     * @throws NullPointerException if the fetcher returns null
     */
    public HorizonsResponseParser.State getOrFetch(
            String spkId,
            AbsoluteDate epoch,
            Function<AbsoluteDate, HorizonsResponseParser.State> fetcher
    ) {
        long secs = (long) epoch.durationFrom(AbsoluteDate.J2000_EPOCH);
        Key k = new Key(spkId, secs);
        return store.computeIfAbsent(k, _key -> {
            HorizonsResponseParser.State state = Objects.requireNonNull(
                fetcher.apply(epoch),
                "fetcher returned null state for " + spkId + " at " + epoch);
            writeToDisk(spkId, secs, state);
            return state;
        });
    }

    private void writeToDisk(String spkId, long epochSeconds, HorizonsResponseParser.State state) {
        if (cacheDir == null) return;
        Path target = cacheDir.resolve(spkId + "_" + epochSeconds + ".json");
        Path tmp = cacheDir.resolve(spkId + "_" + epochSeconds + ".json.tmp");
        try {
            JSON.writeValue(tmp.toFile(), DiskEntry.of(spkId, epochSeconds, state));
            // Atomic rename: prevents partial-write reads on a concurrent
            // load. Fall back to a non-atomic move if the filesystem refuses
            // ATOMIC_MOVE (e.g. across mount points).
            try {
                Files.move(tmp, target,
                    StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ame) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            // Disk write failure is not fatal — the in-memory cache still
            // serves the rest of this process; only future cold-start
            // efficiency is lost.
            log.warn("Failed to persist Horizons cache entry for {} @ {}s: {}",
                spkId, epochSeconds, e.toString());
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) { /* best-effort cleanup */ }
        }
    }

    public int size() { return store.size(); }
}
