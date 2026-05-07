package personal.spacesim.apis.filters;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the per-IP burst and daily limits. Doesn't exercise the servlet
 * pipeline — that's framework glue. The buckets are where the logic lives.
 */
class RateLimitFilterTest {

    @Test
    void burstAllowsExactly60RequestsThenBlocks() {
        RateLimitFilter.IpBuckets ipBuckets = new RateLimitFilter.IpBuckets();

        // First 60 should pass the burst bucket
        for (int i = 0; i < 60; i++) {
            assertTrue(
                    ipBuckets.burst.tryConsume(1),
                    "Request " + (i + 1) + " should be allowed by burst bucket"
            );
        }

        // 61st should be rejected by burst (daily still has plenty)
        assertFalse(
                ipBuckets.burst.tryConsume(1),
                "61st request should be blocked by burst bucket"
        );
    }

    @Test
    void dailyAllowsExactly500RequestsThenBlocks() {
        RateLimitFilter.IpBuckets ipBuckets = new RateLimitFilter.IpBuckets();

        for (int i = 0; i < 500; i++) {
            assertTrue(
                    ipBuckets.daily.tryConsume(1),
                    "Request " + (i + 1) + " should be allowed by daily bucket"
            );
        }

        assertFalse(
                ipBuckets.daily.tryConsume(1),
                "501st request should be blocked by daily bucket"
        );
    }
}
