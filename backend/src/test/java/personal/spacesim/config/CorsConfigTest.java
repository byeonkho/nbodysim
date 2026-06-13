package personal.spacesim.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

/**
 * Pins the allowed-origin parsing. The natural way to write a list in an env
 * var ("a, b") puts a space after each comma; without trimming, that space
 * becomes part of the pattern and silently never matches an Origin header.
 */
class CorsConfigTest {

    @Test
    void parseOriginsTrimsWhitespaceAroundEachEntry() {
        String[] origins = CorsConfig.parseOrigins("https://a.com, https://b.com");
        assertArrayEquals(new String[]{"https://a.com", "https://b.com"}, origins,
                "each origin must be trimmed (no leading space on the second entry)");
    }

    @Test
    void parseOriginsDropsEmptyEntries() {
        // A stray or trailing comma must not yield empty patterns; an empty
        // allowed-origin pattern is meaningless and a misconfiguration risk.
        String[] origins = CorsConfig.parseOrigins("https://a.com, , ");
        assertArrayEquals(new String[]{"https://a.com"}, origins);
    }
}
