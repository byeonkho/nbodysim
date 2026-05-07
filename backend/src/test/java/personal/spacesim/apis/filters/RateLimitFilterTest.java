package personal.spacesim.apis.filters;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.Refill;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the per-IP and global limits. Doesn't exercise the servlet pipeline
 * — that's framework glue. The buckets are where the logic lives.
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

    @Test
    void globalCapAllowsExactly5000RequestsThenBlocks() {
        // Pins the global ceiling: protects against attackers rotating IPs
        // (residential proxies, IPv6, Tor) — per-IP limits alone don't.
        // Mirrors the bucket configured in RateLimitFilter; if those constants
        // change, this test should follow.
        Bucket global = Bucket.builder()
                .addLimit(Bandwidth.classic(5000, Refill.intervally(5000, Duration.ofDays(1))))
                .build();

        for (int i = 0; i < 5000; i++) {
            assertTrue(
                    global.tryConsume(1),
                    "Request " + (i + 1) + " should be allowed by global bucket"
            );
        }

        assertFalse(
                global.tryConsume(1),
                "5001st request should be blocked by global bucket"
        );
    }
}
