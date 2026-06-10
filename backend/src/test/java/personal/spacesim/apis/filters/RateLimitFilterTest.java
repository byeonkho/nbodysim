package personal.spacesim.apis.filters;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the per-IP, per-endpoint limits, the endpoint classification, and the
 * client-IP resolution precedence. Doesn't exercise the servlet pipeline —
 * that's framework glue. The buckets and IP resolution are where the logic
 * (and the silent-failure risk) live.
 */
class RateLimitFilterTest {

    // --- per-endpoint limits ---------------------------------------------

    @Test
    void chunkBurstAllows120ThenBlocks() {
        RateLimitFilter.EndpointBuckets eb =
                new RateLimitFilter.IpBuckets().bucketsFor(RateLimitFilter.ApiEndpoint.CHUNK);

        for (int i = 0; i < 120; i++) {
            assertTrue(eb.burst.tryConsume(1), "chunk burst request " + (i + 1) + " should pass");
        }
        assertFalse(eb.burst.tryConsume(1), "121st chunk burst request should block");
    }

    @Test
    void chunkDailyAllows3000ThenBlocks() {
        RateLimitFilter.EndpointBuckets eb =
                new RateLimitFilter.IpBuckets().bucketsFor(RateLimitFilter.ApiEndpoint.CHUNK);

        for (int i = 0; i < 3_000; i++) {
            assertTrue(eb.daily.tryConsume(1), "chunk daily request " + (i + 1) + " should pass");
        }
        assertFalse(eb.daily.tryConsume(1), "3001st chunk daily request should block");
    }

    @Test
    void initializeIsTighterThanChunk() {
        RateLimitFilter.EndpointBuckets init =
                new RateLimitFilter.IpBuckets().bucketsFor(RateLimitFilter.ApiEndpoint.INITIALIZE);

        // Burst: 20/min
        for (int i = 0; i < 20; i++) {
            assertTrue(init.burst.tryConsume(1), "initialize burst request " + (i + 1) + " should pass");
        }
        assertFalse(init.burst.tryConsume(1), "21st initialize burst request should block");

        // Daily: 300/day (drain the remaining daily allowance; 20 already spent
        // above came from the burst bucket, the daily bucket is independent).
        RateLimitFilter.EndpointBuckets init2 =
                new RateLimitFilter.IpBuckets().bucketsFor(RateLimitFilter.ApiEndpoint.INITIALIZE);
        for (int i = 0; i < 300; i++) {
            assertTrue(init2.daily.tryConsume(1), "initialize daily request " + (i + 1) + " should pass");
        }
        assertFalse(init2.daily.tryConsume(1), "301st initialize daily request should block");
    }

    // --- endpoint classification -----------------------------------------

    @Test
    void classifyMapsKnownPaths() {
        assertEquals(RateLimitFilter.ApiEndpoint.INITIALIZE,
                RateLimitFilter.ApiEndpoint.classify("/api/simulation/initialize"));
        assertEquals(RateLimitFilter.ApiEndpoint.CHUNK,
                RateLimitFilter.ApiEndpoint.classify("/api/simulation/chunk"));
        assertEquals(RateLimitFilter.ApiEndpoint.GROUND_TRUTH,
                RateLimitFilter.ApiEndpoint.classify("/api/simulation/ground-truth"));
        assertEquals(RateLimitFilter.ApiEndpoint.OTHER,
                RateLimitFilter.ApiEndpoint.classify("/api/simulation/something-new"));
    }

    // --- client IP resolution (Cloudflare-first) -------------------------

    @Test
    void resolveClientIpPrefersCloudflareHeader() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.1");                       // platform proxy
        req.addHeader("X-Forwarded-For", "203.0.113.9, 10.0.0.1");
        req.addHeader("CF-Connecting-IP", "198.51.100.7");   // true client per Cloudflare

        assertEquals("198.51.100.7", RateLimitFilter.resolveClientIp(req),
                "CF-Connecting-IP must win when present");
    }

    @Test
    void resolveClientIpFallsBackToFirstForwardedHop() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.1");
        req.addHeader("X-Forwarded-For", "203.0.113.9, 70.41.3.18, 10.0.0.1");

        assertEquals("203.0.113.9", RateLimitFilter.resolveClientIp(req),
                "first X-Forwarded-For hop is the original client");
    }

    @Test
    void resolveClientIpFallsBackToRemoteAddr() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("192.0.2.55");

        assertEquals("192.0.2.55", RateLimitFilter.resolveClientIp(req),
                "remoteAddr is the last resort for direct/local connections");
    }
}
