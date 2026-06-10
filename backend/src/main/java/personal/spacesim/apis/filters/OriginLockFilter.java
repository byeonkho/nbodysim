package personal.spacesim.apis.filters;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Locks the public {@code /api/**} surface to traffic that arrived through
 * Cloudflare.
 *
 * <p>The backend has two public doors: the Cloudflare-proxied custom domain
 * (the front door, where DDoS/bot filtering and the trusted {@code
 * CF-Connecting-IP} header live) and the raw platform URL (a side door an
 * attacker could hit directly, spoofing {@code CF-Connecting-IP} to evade the
 * per-IP rate limiter). This filter closes the side door: Cloudflare stamps a
 * shared secret onto every request it forwards (via a Transform Rule), and the
 * backend rejects any {@code /api} request whose {@code X-Origin-Secret} header
 * doesn't match.
 *
 * <p><b>Inert unless configured.</b> When {@code spacesim.origin-secret} is
 * unset/blank (local dev, or a deploy before the secret is wired), the filter
 * passes everything through, so it can never accidentally lock out real
 * visitors. It logs a warning at startup in that case.
 *
 * <p>Scope: only {@code /api/**}. {@code /actuator/health} stays open because
 * the platform's own health check hits the origin directly, not via Cloudflare,
 * so it would never carry the secret. CORS preflights (OPTIONS) are exempt.
 *
 * <p>Runs before {@link RateLimitFilter} so side-door traffic is rejected
 * before any rate-limit bucket work.
 */
@Component
@Order(1)
public class OriginLockFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(OriginLockFilter.class);
    private static final String SECRET_HEADER = "X-Origin-Secret";

    private final String originSecret;
    private final boolean enabled;

    public OriginLockFilter(@Value("${spacesim.origin-secret:}") String originSecret) {
        this.originSecret = originSecret == null ? "" : originSecret;
        this.enabled = !this.originSecret.isBlank();
        if (!enabled) {
            logger.warn("Origin lock disabled (spacesim.origin-secret unset): /api is reachable "
                    + "directly, not only via Cloudflare. Set the secret in production.");
        }
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain
    ) throws ServletException, IOException {
        String uri = request.getRequestURI();
        if (!enabled || !uri.startsWith("/api/") || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        if (!secretMatches(request.getHeader(SECRET_HEADER))) {
            sendForbidden(request, response);
            return;
        }

        chain.doFilter(request, response);
    }

    private boolean secretMatches(String provided) {
        if (provided == null) {
            return false;
        }
        // Constant-time compare so a direct attacker can't byte-by-byte guess
        // the secret from response timing.
        return MessageDigest.isEqual(
                originSecret.getBytes(StandardCharsets.UTF_8),
                provided.getBytes(StandardCharsets.UTF_8));
    }

    private static void sendForbidden(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        // Echo the Origin so that if this ever fires for a real browser request
        // (a Cloudflare Transform Rule misconfig), the browser surfaces a clear
        // 403 rather than an opaque CORS failure.
        String origin = request.getHeader("Origin");
        if (origin != null) {
            response.setHeader("Access-Control-Allow-Origin", origin);
            response.setHeader("Vary", "Origin");
        }
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"Forbidden\"}");
    }
}
