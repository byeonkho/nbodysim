package personal.spacesim.apis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end verification (and before/after measurement) of HTTP response
 * compression, configured in {@code application.properties}.
 *
 * <p>Boots the real embedded Tomcat on a random port so compression happens at
 * the connector (MockMvc would bypass it). Uses the JDK {@link HttpClient},
 * which neither sends {@code Accept-Encoding} automatically nor auto-decompresses
 * the response — so we can request the same endpoint with and without gzip and
 * compare the actual bytes on the wire.
 *
 * <p>Pins two behaviours that must not silently regress:
 * <ul>
 *   <li>{@code /ground-truth} (JSON) is gzip-compressed and substantially
 *       smaller than the identity response.</li>
 *   <li>{@code /chunk} (application/octet-stream, already zstd-compressed) is
 *       NOT gzip-compressed — the mime-type allow-list excludes it, so we never
 *       double-compress the binary payload.</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class HttpCompressionTest {

    @LocalServerPort
    private int port;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();

    private String base() {
        return "http://localhost:" + port + "/api/simulation";
    }

    @Test
    void groundTruthJsonIsGzipCompressed_chunkOctetStreamIsNot() throws Exception {
        // 1) Create a session via /initialize and read back its sessionID.
        String initBody = """
            {
              "celestialBodyNames": ["Sun","Mercury","Venus","Earth","Moon","Mars","Jupiter","Saturn","Uranus","Neptune"],
              "date": "2026-01-01T00:00:00.000",
              "frame": "ICRF",
              "integrator": "rk4",
              "timeStepUnit": "hours",
              "fidelityBucket": null
            }
            """;
        HttpResponse<String> init = http.send(
            HttpRequest.newBuilder(URI.create(base() + "/initialize"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(initBody))
                .build(),
            HttpResponse.BodyHandlers.ofString());
        assertEquals(200, init.statusCode(), "initialize should succeed");
        JsonNode initJson = mapper.readTree(init.body());
        String sessionId = initJson.path("simulationMetaData").path("sessionID").asText();
        assertNotNull(sessionId);
        assertTrue(!sessionId.isBlank(), "sessionID present");

        // 2) Ground-truth over a 1-year window — fetch it twice, with and
        //    without gzip, and compare the raw transferred bytes.
        long fromEpoch = Instant.parse("2026-01-01T00:00:00Z").toEpochMilli();
        long toEpoch = fromEpoch + 365L * 24 * 60 * 60 * 1000;
        String gtUrl = base() + "/ground-truth?sessionId=" + sessionId
            + "&fromEpoch=" + fromEpoch + "&toEpoch=" + toEpoch;

        HttpResponse<byte[]> identity = http.send(
            HttpRequest.newBuilder(URI.create(gtUrl)).header("Accept-Encoding", "identity").GET().build(),
            HttpResponse.BodyHandlers.ofByteArray());
        HttpResponse<byte[]> gzipped = http.send(
            HttpRequest.newBuilder(URI.create(gtUrl)).header("Accept-Encoding", "gzip").GET().build(),
            HttpResponse.BodyHandlers.ofByteArray());

        assertEquals(200, identity.statusCode());
        assertEquals(200, gzipped.statusCode());

        int rawBytes = identity.body().length;
        int gzipBytes = gzipped.body().length;
        String gtEncoding = gzipped.headers().firstValue("Content-Encoding").orElse("(none)");

        System.out.println();
        System.out.println("=== HTTP compression: /ground-truth (1-year window) ===");
        System.out.printf("  BEFORE (identity): %,d bytes (%.1f KB)%n", rawBytes, rawBytes / 1024.0);
        System.out.printf("  AFTER  (gzip):     %,d bytes (%.1f KB)  Content-Encoding=%s%n",
            gzipBytes, gzipBytes / 1024.0, gtEncoding);
        System.out.printf("  reduction:         %.0f%% smaller%n", 100.0 * (1.0 - (double) gzipBytes / rawBytes));

        assertEquals("gzip", gtEncoding, "ground-truth JSON must be gzip-encoded when gzip is accepted");
        assertTrue(gzipBytes < rawBytes * 0.6,
            "gzip should cut the ground-truth JSON by well over 40% (got "
                + gzipBytes + " vs " + rawBytes + ")");

        // 3) Chunk payload is application/octet-stream (zstd already) — must NOT
        //    be gzip-compressed even when the client accepts gzip.
        String chunkBody = "{\"sessionID\":\"" + sessionId + "\"}";
        HttpResponse<byte[]> chunk = http.send(
            HttpRequest.newBuilder(URI.create(base() + "/chunk"))
                .header("Content-Type", "application/json")
                .header("Accept-Encoding", "gzip")
                .POST(HttpRequest.BodyPublishers.ofString(chunkBody))
                .build(),
            HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200, chunk.statusCode());
        String chunkEncoding = chunk.headers().firstValue("Content-Encoding").orElse("(none)");
        System.out.println("=== /chunk (octet-stream) Content-Encoding = " + chunkEncoding
            + " (expected: not gzip) ===");
        assertTrue(!"gzip".equals(chunkEncoding),
            "the already-zstd'd chunk payload must NOT be gzip double-compressed");
    }
}
