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
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-IP token bucket rate limiter for the public {@code /api/**} surface.
 *
 * <p>Two buckets per IP, both must allow the request:
 * <ul>
 *   <li><b>Burst:</b> 60 req/min, intervally refilled. Comfortably allows
 *       max-speed playback (~50 chunk requests/min) with headroom.</li>
 *   <li><b>Daily:</b> 500 req/day, intervally refilled. Caps total bandwidth
 *       cost per IP at ~2 GB/day given a 4 MB chunk size.</li>
 * </ul>
 *
 * <p>On limit hit: {@code 429 Too Many Requests} with a {@code Retry-After}
 * header (seconds). Bucket entries are evicted hourly if idle for 24 h.
 *
 * <p>IP detection prefers the first {@code X-Forwarded-For} hop (for Fly.io's
 * proxy) and falls back to {@code remoteAddr} for direct/localhost.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(RateLimitFilter.class);

    private static final int BURST_LIMIT_PER_MINUTE = 60;
    private static final int DAILY_LIMIT = 500;
    private static final long IDLE_BUCKET_TTL_MS = 24L * 60 * 60 * 1000;

    private final ConcurrentHashMap<String, IpBuckets> buckets = new ConcurrentHashMap<>();

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
        IpBuckets ipBuckets = buckets.computeIfAbsent(ip, k -> new IpBuckets());
        ipBuckets.touch();

        ConsumptionProbe burst = ipBuckets.burst.tryConsumeAndReturnRemaining(1);
        if (!burst.isConsumed()) {
            sendTooManyRequests(request, response, burst.getNanosToWaitForRefill(), ip, "burst");
            return;
        }

        ConsumptionProbe daily = ipBuckets.daily.tryConsumeAndReturnRemaining(1);
        if (!daily.isConsumed()) {
            sendTooManyRequests(request, response, daily.getNanosToWaitForRefill(), ip, "daily");
            return;
        }

        chain.doFilter(request, response);
    }

    private static String resolveClientIp(HttpServletRequest request) {
        // Fly.io proxies set X-Forwarded-For. Take the first entry (the original
        // client) — subsequent entries are downstream proxies. Trust this header
        // because Fly's edge strips any client-supplied value.
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma == -1 ? forwarded : forwarded.substring(0, comma)).trim();
        }
        return request.getRemoteAddr();
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

    static final class IpBuckets {
        final Bucket burst;
        final Bucket daily;
        volatile long lastAccessAt;

        IpBuckets() {
            this.burst = Bucket.builder()
                    .addLimit(Bandwidth.classic(
                            BURST_LIMIT_PER_MINUTE,
                            Refill.intervally(BURST_LIMIT_PER_MINUTE, Duration.ofMinutes(1))
                    ))
                    .build();
            this.daily = Bucket.builder()
                    .addLimit(Bandwidth.classic(
                            DAILY_LIMIT,
                            Refill.intervally(DAILY_LIMIT, Duration.ofDays(1))
                    ))
                    .build();
            this.lastAccessAt = System.currentTimeMillis();
        }

        void touch() {
            this.lastAccessAt = System.currentTimeMillis();
        }
    }
}
