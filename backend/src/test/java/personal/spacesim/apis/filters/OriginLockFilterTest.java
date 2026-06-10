package personal.spacesim.apis.filters;

import jakarta.servlet.ServletException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the origin-lock contract: when a secret is configured, only requests
 * carrying it reach {@code /api}; health checks and preflights stay open; and
 * with no secret the filter is inert (so it can't lock out a misconfigured or
 * local deploy).
 */
class OriginLockFilterTest {

    private static final String SECRET = "s3cr3t-value";
    private static final String HEADER = "X-Origin-Secret";

    private static MockHttpServletRequest api(String method) {
        return new MockHttpServletRequest(method, "/api/simulation/chunk");
    }

    /** Runs the filter and reports whether the request reached the chain. */
    private static boolean passedThrough(OriginLockFilter filter, MockHttpServletRequest req)
            throws ServletException, IOException {
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        return chain.getRequest() != null;
    }

    @Test
    void disabledFilterPassesEverything() throws Exception {
        // No secret configured -> inert, even without the header.
        assertTrue(passedThrough(new OriginLockFilter(""), api("POST")),
                "disabled filter must pass the request through");
    }

    @Test
    void allowsMatchingSecret() throws Exception {
        MockHttpServletRequest req = api("POST");
        req.addHeader(HEADER, SECRET);
        assertTrue(passedThrough(new OriginLockFilter(SECRET), req),
                "matching secret must pass through");
    }

    @Test
    void rejectsMissingSecretWith403() throws Exception {
        OriginLockFilter filter = new OriginLockFilter(SECRET);
        MockHttpServletResponse res = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(api("POST"), res, chain);

        assertNull(chain.getRequest(), "missing secret must be blocked");
        assertEquals(403, res.getStatus());
    }

    @Test
    void rejectsWrongSecret() throws Exception {
        MockHttpServletRequest req = api("POST");
        req.addHeader(HEADER, "not-the-secret");
        assertFalse(passedThrough(new OriginLockFilter(SECRET), req),
                "wrong secret must be blocked");
    }

    @Test
    void healthCheckBypassesLock() throws Exception {
        // The platform health check hits the origin directly (not via Cloudflare),
        // so it never carries the secret and must not be locked out.
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/actuator/health");
        assertTrue(passedThrough(new OriginLockFilter(SECRET), req),
                "health check must bypass the lock");
    }

    @Test
    void optionsPreflightBypassesLock() throws Exception {
        assertTrue(passedThrough(new OriginLockFilter(SECRET), api("OPTIONS")),
                "CORS preflight must bypass the lock");
    }
}
