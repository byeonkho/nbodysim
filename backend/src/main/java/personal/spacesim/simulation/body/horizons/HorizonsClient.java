package personal.spacesim.simulation.body.horizons;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.Semaphore;

/**
 * Thin HTTP client over the JPL Horizons CGI API. Fetches a single-epoch
 * state vector for a body identified by its SPK ID, in heliocentric ICRF.
 *
 * <p>Heliocentric ({@code CENTER='@10'} — body 10 is the Sun) matches the
 * Sun-relative shifting done elsewhere in the simulation pipeline. The
 * returned state can be packed directly into the integrator buffer
 * alongside Orekit-sourced major-planet states without further frame
 * conversion.
 *
 * <p>This runs at sim-submit time (once per minor body, wrapped by
 * {@link HorizonsStateCache}), not per timestep, so the HTTP/JSON cost
 * is irrelevant to the integrator hot path.
 */
@Component
public class HorizonsClient {

    private static final String API_BASE = "https://ssd.jpl.nasa.gov/api/horizons.api";
    private static final DateTimeFormatter HORIZONS_DT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    /**
     * Identifies this client to JPL. They publish no numeric rate limit;
     * their guidance is to be a good citizen and identify yourself so they
     * can email before any block. The email is the on-record contact for
     * this project's portfolio deployment.
     */
    private static final String USER_AGENT = "spacesim/1.0 (byeon.kho@gmail.com)";

    /**
     * Default retry policy for transient JPL failures. Three attempts with
     * 1s/2s base sleeps between retries. JPL's overload signal is 503, not
     * 429; we also retry on network-layer failures (ResourceAccessException)
     * since those are usually transient.
     */
    private static final int DEFAULT_MAX_ATTEMPTS = 3;
    private static final long DEFAULT_INITIAL_BACKOFF_MS = 1000L;

    /**
     * Global single-permit, fair semaphore: JPL Horizons explicitly asks
     * clients to submit "only one API request at a time" (per the API
     * documentation). The {@link HorizonsStateCache} already serializes
     * per-key fetches via {@code computeIfAbsent}, but distinct keys
     * (e.g. EROS and BENNU) would otherwise race when multiple users
     * submit cold sims simultaneously. This permit enforces the rule
     * globally across all threads in the process. Fair = FIFO ordering
     * so no submission gets perpetually starved.
     */
    private static final Semaphore JPL_PERMIT = new Semaphore(1, true);

    private final RestClient http;
    private final int maxAttempts;
    private final long initialBackoffMillis;

    @Autowired
    public HorizonsClient(RestClient.Builder builder) {
        this(builder, DEFAULT_MAX_ATTEMPTS, DEFAULT_INITIAL_BACKOFF_MS);
    }

    /**
     * Test-only constructor — allows shorter backoff so retry tests run
     * in milliseconds instead of seconds. Package-private on purpose.
     */
    HorizonsClient(RestClient.Builder builder, int maxAttempts, long initialBackoffMillis) {
        this.http = builder
            .baseUrl(API_BASE)
            .defaultHeader("User-Agent", USER_AGENT)
            .build();
        this.maxAttempts = maxAttempts;
        this.initialBackoffMillis = initialBackoffMillis;
    }

    public HorizonsResponseParser.State fetchState(String spkId, AbsoluteDate epoch) {
        String startTime = formatEpoch(epoch);
        String stopTime  = formatEpoch(epoch.shiftedBy(60.0));  // 1-minute window

        // Assembled manually rather than via Spring's URI builder because
        // JPL's parser breaks on a literal ';' in the query string and
        // Spring's default UriBuilderFactory encoding modes leave ';'
        // unescaped per RFC 3986 (where ';' is a "sub-delim" allowed in
        // query components). URLEncoder.encode() (form-encoded) does
        // encode ';' to %3B, which is what JPL accepts.
        String url = API_BASE
            + "?format=text"
            // Horizons resolves a bare numeric COMMAND as an IAU asteroid
            // number (range 1..887103). SPK IDs for numbered asteroids start
            // at 2_000_001 (= 2_000_000 + IAU number), well outside that
            // range, so the bare form fails with "out of bounds". Wrapping
            // as DES=<spkId>; forces the small-body designation lookup —
            // JPL's own error message documents this fallback.
            + "&COMMAND=" + encodeQueryValue("'DES=" + spkId + ";'")
            + "&OBJ_DATA=" + encodeQueryValue("'NO'")
            + "&MAKE_EPHEM=" + encodeQueryValue("'YES'")
            + "&EPHEM_TYPE=" + encodeQueryValue("'VECTORS'")
            + "&CENTER=" + encodeQueryValue("'@10'")
            + "&START_TIME=" + encodeQueryValue("'" + startTime + "'")
            + "&STOP_TIME=" + encodeQueryValue("'" + stopTime + "'")
            + "&STEP_SIZE=" + encodeQueryValue("'1'")
            + "&OUT_UNITS=" + encodeQueryValue("'KM-S'")
            + "&REF_PLANE=" + encodeQueryValue("'FRAME'")
            + "&REF_SYSTEM=" + encodeQueryValue("'ICRF'")
            + "&VEC_TABLE=" + encodeQueryValue("'2'");

        // URI.create() takes a pre-encoded string verbatim; passing the
        // String form to RestClient.uri() would re-encode our '%' characters
        // (to '%25'), corrupting the manually-encoded ';' and '='.
        URI uri = URI.create(url);
        String body;
        try {
            // Block until the global JPL permit is available. With one
            // permit and fair queueing, at most one HTTP call is in
            // flight to JPL across the entire process.
            JPL_PERMIT.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new HorizonsFetchException(
                "Interrupted waiting for JPL Horizons permit (SPK " + spkId
                    + " at " + epoch + ")", e);
        }
        try {
            body = fetchWithRetry(uri, spkId, epoch);
        } finally {
            JPL_PERMIT.release();
        }
        if (body == null || body.isEmpty()) {
            throw new HorizonsFetchException(
                "Empty Horizons response for SPK " + spkId);
        }
        return HorizonsResponseParser.parseFirstRecord(body);
    }

    /**
     * Execute the GET with exponential backoff on transient failures.
     * Retries on {@link HttpServerErrorException} (any 5xx — JPL signals
     * overload as 503) and {@link ResourceAccessException} (network-layer
     * errors like connection reset, DNS hiccups, read timeouts). Does NOT
     * retry on 4xx (client error: malformed query, unknown body — repeat
     * attempts cannot fix these and only waste JPL quota).
     */
    private String fetchWithRetry(URI uri, String spkId, AbsoluteDate epoch) {
        long backoff = initialBackoffMillis;
        RestClientException lastTransient = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return http.get().uri(uri).retrieve().body(String.class);
            } catch (HttpServerErrorException | ResourceAccessException transientErr) {
                lastTransient = transientErr;
                if (attempt < maxAttempts) {
                    try {
                        Thread.sleep(backoff);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new HorizonsFetchException(
                            "Interrupted during retry backoff for SPK " + spkId
                                + " at " + epoch, ie);
                    }
                    backoff *= 2;
                }
            } catch (RestClientException nonRetryable) {
                throw new HorizonsFetchException(
                    "Failed to fetch state for SPK " + spkId + " at " + epoch,
                    nonRetryable);
            }
        }
        throw new HorizonsFetchException(
            "Failed to fetch state for SPK " + spkId + " at " + epoch
                + " after " + maxAttempts + " attempts", lastTransient);
    }

    /**
     * Form-encode a query parameter value and switch '+' (the form
     * encoding for space) to '%20' so spaces match JPL's expected
     * canonical encoding.
     */
    private static String encodeQueryValue(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private String formatEpoch(AbsoluteDate date) {
        // Horizons accepts dates in "yyyy-MM-dd HH:mm" UTC.
        // AbsoluteDate.toString(UTC) returns "yyyy-MM-ddTHH:mm:ss.sss".
        String iso = date.toString(TimeScalesFactory.getUTC());
        LocalDateTime ldt = LocalDateTime.parse(iso);
        return ldt.format(HORIZONS_DT);
    }

    public static class HorizonsFetchException extends RuntimeException {
        public HorizonsFetchException(String msg) { super(msg); }
        public HorizonsFetchException(String msg, Throwable cause) { super(msg, cause); }
    }
}
