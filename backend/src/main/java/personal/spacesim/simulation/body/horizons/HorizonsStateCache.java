package personal.spacesim.simulation.body.horizons;

import org.orekit.time.AbsoluteDate;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Process-local cache for Horizons state-vector responses, keyed by
 * SPK ID + epoch. State vectors at any (body, epoch) are deterministic
 * from JPL's orbit fits — once fetched, no need to re-query.
 *
 * <p>Cache key uses epoch durations from J2000 truncated to whole seconds.
 * Horizons resolution is per-minute at best for small-body queries; sub-second
 * key collisions are physically impossible at our chunk scale.
 *
 * <p>Lookup happens at sim-submit time (once per body), not per timestep,
 * so the {@code ConcurrentHashMap} overhead is irrelevant to the hot path.
 */
@Component
public class HorizonsStateCache {

    private record Key(String spkId, long epochSecondsFromJ2000) {}

    private final ConcurrentHashMap<Key, HorizonsResponseParser.State> store =
            new ConcurrentHashMap<>();

    /**
     * Return cached state for (spkId, epoch), or compute it via the supplied
     * fetcher and cache the result. The fetcher receives the requested epoch.
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
        return store.computeIfAbsent(k, _key -> Objects.requireNonNull(
            fetcher.apply(epoch),
            "fetcher returned null state for " + spkId + " at " + epoch));
    }

    public int size() { return store.size(); }
}
