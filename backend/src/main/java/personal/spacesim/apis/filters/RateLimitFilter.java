package personal.spacesim.apis.filters;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.Refill;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.EnumMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-IP, per-endpoint token-bucket rate limiter for the public {@code /api/**}
 * surface.
 *
 * <p>Layered defense (Railway origin behind a Cloudflare proxy):
 * <ul>
 *   <li><b>Cloudflare's edge</b> owns DDoS, bots, and IP-rotation abuse — it
 *       turns floods away before they reach the origin (saving compute and
 *       egress), which a per-IP app limiter fundamentally can't. So these
 *       app-level limits are a <em>fairness</em> backstop (no single client
 *       starves others), not the primary abuse defense.</li>
 *   <li><b>Per-endpoint buckets</b> because the endpoints differ wildly in cost
 *       and cadence. The previous single shared bucket (60/min + 500/day across
 *       all of {@code /api}) throttled an engaged viewer in ~10 minutes:
 *       high-speed playback fires ~50 chunk requests/min, so a shared 500/day
 *       was spent almost immediately. Splitting per endpoint lets the
 *       frequent-but-cheap {@code /chunk} path run generously while the
 *       expensive {@code /initialize} stays tight.</li>
 *   <li><b>Global cap</b> is a high last-resort circuit breaker, not a tight
 *       budget. The previous global 5000/day returned 429 to <em>every</em>
 *       client once exhausted — a self-DoS under exactly the traffic spike a
 *       portfolio wants. The real cost ceiling is a platform spend cap; this
 *       50k/day backstop only trips if a flood somehow reaches the origin.</li>
 * </ul>
 *
 * <p>Per-endpoint per-IP limits (burst / daily):
 * <ul>
 *   <li>{@code /initialize}: 20/min, 300/day — rare, builds a whole session.</li>
 *   <li>{@code /chunk}: 120/min, 3000/day — ~2.4x the ~50/min playback rate;
 *       3000/day is ~1 h of continuous max-speed playback before one IP is
 *       capped (~9 GB at ~3 MB/chunk).</li>
 *   <li>{@code /ground-truth}: 120/min, 3000/day — small payload, moderate
 *       cadence when the drift overlay is on.</li>
 *   <li>any other {@code /api} path: 60/min, 500/day — conservative default.</li>
 * </ul>
 *
 * <p>On limit hit: {@code 429 Too Many Requests} with a {@code Retry-After}
 * header (seconds). Bucket entries are evicted hourly if idle for 24 h.
 *
 * <p>Client IP is resolved Cloudflare-first ({@code CF-Connecting-IP}), then the
 * first {@code X-Forwarded-For} hop, then {@code remoteAddr}. Behind Cloudflare
 * the true client is in {@code CF-Connecting-IP}; trusting it is only safe
 * because the origin is locked to accept Cloudflare traffic at deploy time —
 * otherwise the header is client-spoofable.
 *
 * <p>Loopback clients (localhost) are exempt from all limits: local development
 * has no Cloudflare edge in front of it, so a developer exercising the API while
 * testing shouldn't throttle themselves. This is safe because a real production
 * client's IP comes from {@code CF-Connecting-IP} (never loopback) and
 * {@link OriginLockFilter} already blocks non-Cloudflare traffic.
 */
@Component
@Order(2) // after OriginLockFilter (@Order(1)) so side-door traffic is rejected first
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(RateLimitFilter.class);

    /** Global last-resort circuit breaker across all IPs (see class doc). */
    private static final int GLOBAL_DAILY_LIMIT = 50_000;
    private static final long IDLE_BUCKET_TTL_MS = 24L * 60 * 60 * 1000;

    /**
     * Per-endpoint per-IP limits. Package-private so the test can pin the
     * (burst, daily) values that the production buckets are built from.
     */
    enum ApiEndpoint {
        INITIALIZE(20, 300),
        CHUNK(120, 3_000),
        GROUND_TRUTH(120, 3_000),
        OTHER(60, 500);

        final int burstPerMinute;
        final int daily;

        ApiEndpoint(int burstPerMinute, int daily) {
            this.burstPerMinute = burstPerMinute;
            this.daily = daily;
        }

        static ApiEndpoint classify(String uri) {
            if (uri.endsWith("/initialize")) return INITIALIZE;
            if (uri.endsWith("/chunk")) return CHUNK;
            if (uri.endsWith("/ground-truth")) return GROUND_TRUTH;
            return OTHER;
        }
    }

    private final ConcurrentHashMap<String, IpBuckets> buckets = new ConcurrentHashMap<>();

    private final Bucket globalBucket = Bucket.builder()
            .addLimit(Bandwidth.classic(
                    GLOBAL_DAILY_LIMIT,
                    Refill.intervally(GLOBAL_DAILY_LIMIT, Duration.ofDays(1))
            ))
            .build();

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {
        // Only rate-limit /api/**. CORS preflights (OPTIONS) are exempt: they're
        // browser handshake traffic, not real work, and rate-limiting them
        // would double-count every legitimate request.
        String uri = request.getRequestURI();
        if (!uri.startsWith("/api/") || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        String ip = resolveClientIp(request);

        // Localhost is exempt: local development has no Cloudflare edge in front
        // of it, so a developer exercising the API while testing shouldn't 429
        // themselves. In production the client IP comes from CF-Connecting-IP (a
        // real public address, never loopback) and OriginLockFilter already
        // rejects non-Cloudflare side-door traffic, so this never matches a real
        // client.
        if (isLoopback(ip)) {
            chain.doFilter(request, response);
            return;
        }

        ApiEndpoint endpoint = ApiEndpoint.classify(uri);
        IpBuckets ipBuckets = buckets.computeIfAbsent(ip, k -> new IpBuckets());
        ipBuckets.touch();

        EndpointBuckets eb = ipBuckets.bucketsFor(endpoint);

        ConsumptionProbe burst = eb.burst.tryConsumeAndReturnRemaining(1);
        if (!burst.isConsumed()) {
            sendTooManyRequests(request, response, burst.getNanosToWaitForRefill(), ip, endpoint + " burst");
            return;
        }

        ConsumptionProbe daily = eb.daily.tryConsumeAndReturnRemaining(1);
        if (!daily.isConsumed()) {
            sendTooManyRequests(request, response, daily.getNanosToWaitForRefill(), ip, endpoint + " daily");
            return;
        }

        // Global cap is checked LAST so per-IP tokens spent above are still
        // accounted for. Order also means a single bad IP can't deny service
        // by burning the global bucket on requests it would have been
        // rate-limited from anyway.
        ConsumptionProbe global = globalBucket.tryConsumeAndReturnRemaining(1);
        if (!global.isConsumed()) {
            sendTooManyRequests(request, response, global.getNanosToWaitForRefill(), ip, "global");
            return;
        }

        chain.doFilter(request, response);
    }

    // Package-private (not private) so the test can pin the resolution
    // precedence directly — getting this wrong behind Cloudflare collapses
    // every visitor into one bucket and throttles them all instantly.
    static String resolveClientIp(HttpServletRequest request) {
        // Behind Cloudflare the true client is in CF-Connecting-IP. Trusting it
        // is safe only because the origin is locked to Cloudflare traffic at
        // deploy time; without that lock the header is client-spoofable.
        String cf = request.getHeader("CF-Connecting-IP");
        if (cf != null && !cf.isBlank()) {
            return cf.trim();
        }
        // Fallback for non-Cloudflare proxies (Railway's own edge, local dev).
        // First hop is the original client; later hops are downstream proxies.
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma == -1 ? forwarded : forwarded.substring(0, comma)).trim();
        }
        return request.getRemoteAddr();
    }

    /**
     * True for loopback client addresses (IPv4 {@code 127.0.0.0/8}, IPv6
     * {@code ::1} and its expanded / IPv4-mapped forms, and the literal
     * {@code localhost}). Used to exempt local development from rate limiting.
     * Package-private so the test can pin the scope: exempting too broadly would
     * silently disable the limiter for real clients.
     */
    static boolean isLoopback(String ip) {
        if (ip == null || ip.isBlank()) {
            return false;
        }
        String addr = ip.trim();
        return addr.startsWith("127.")
                || addr.equals("::1")
                || addr.equals("0:0:0:0:0:0:0:1")
                || addr.equals("::ffff:127.0.0.1")
                || addr.equalsIgnoreCase("localhost");
    }

    private static void sendTooManyRequests(
            HttpServletRequest request,
            HttpServletResponse response,
            long nanosToWait,
            String ip,
            String which
    ) throws IOException {
        long secondsToWait = Math.max(1, nanosToWait / 1_000_000_000L);

        // Spring's CORS via WebMvcConfigurer adds Access-Control-* headers
        // inside the dispatcher (HandlerMapping), which never runs for our
        // short-circuited 429 response. Echo the request Origin manually so
        // the browser doesn't drop the response as a CORS failure and the
        // frontend sees the 429 it can act on. Allow-list validation isn't
        // needed here — the request already passed CORS preflight.
        String origin = request.getHeader("Origin");
        if (origin != null) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
        }

        response.setStatus(429); // jakarta servlet doesn't define a SC_ constant for 429
        response.setHeader("Retry-After", String.valueOf(secondsToWait));
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"error\":\"Rate limit exceeded\",\"retryAfterSeconds\":" + secondsToWait + "}"
        );
        logger.info("Rate limit hit ({}) for {}: retry after {}s", which, ip, secondsToWait);
    }

    /**
     * Drop bucket entries idle longer than IDLE_BUCKET_TTL_MS so the map
     * doesn't grow unbounded under wide IP fan-out. Runs hourly.
     */
    @Scheduled(fixedRate = 60L * 60 * 1000)
    public void evictIdleBuckets() {
        long now = System.currentTimeMillis();
        buckets.entrySet().removeIf(e -> now - e.getValue().lastAccessAt > IDLE_BUCKET_TTL_MS);
    }

    /** Burst + daily bucket pair for one endpoint, built from its limits. */
    static final class EndpointBuckets {
        final Bucket burst;
        final Bucket daily;

        EndpointBuckets(ApiEndpoint endpoint) {
            this.burst = Bucket.builder()
                    .addLimit(Bandwidth.classic(
                            endpoint.burstPerMinute,
                            Refill.intervally(endpoint.burstPerMinute, Duration.ofMinutes(1))
                    ))
                    .build();
            this.daily = Bucket.builder()
                    .addLimit(Bandwidth.classic(
                            endpoint.daily,
                            Refill.intervally(endpoint.daily, Duration.ofDays(1))
                    ))
                    .build();
        }
    }

    /**
     * Per-IP holder of endpoint bucket pairs, created lazily on first use of
     * each endpoint. Package-private for the test.
     */
    static final class IpBuckets {
        private final EnumMap<ApiEndpoint, EndpointBuckets> perEndpoint =
                new EnumMap<>(ApiEndpoint.class);
        volatile long lastAccessAt;

        IpBuckets() {
            this.lastAccessAt = System.currentTimeMillis();
        }

        synchronized EndpointBuckets bucketsFor(ApiEndpoint endpoint) {
            return perEndpoint.computeIfAbsent(endpoint, EndpointBuckets::new);
        }

        void touch() {
            this.lastAccessAt = System.currentTimeMillis();
        }
    }
}
