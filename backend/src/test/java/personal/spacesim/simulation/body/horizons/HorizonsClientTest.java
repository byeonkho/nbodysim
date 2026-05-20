package personal.spacesim.simulation.body.horizons;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.RequestMatcher;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

class HorizonsClientTest {

    private MockRestServiceServer server;
    private HorizonsClient client;
    private String capturedResponse;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = HorizonsClientTest.class.getClassLoader()
                    .getResource("orekit-data-master");
            if (url != null) {
                Path path = Paths.get(url.toURI());
                DataContext.getDefault().getDataProvidersManager()
                        .addProvider(new DirectoryCrawler(path.toFile()));
            }
        } catch (URISyntaxException e) {
            throw new UncheckedIOException(new IOException(e));
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();

        client = new HorizonsClient(builder);
        capturedResponse = Files.readString(
            new ClassPathResource("horizons/eros-j2000-response.txt").getFile().toPath());
    }

    @Test
    void buildsQueryWithSpkIdAndCenter10_andParsesResponse() {
        // Request matcher: the URL must contain the SPK id wrapped as a
        // designation lookup. Horizons interprets a bare numeric "2000433"
        // as IAU asteroid number 2000433, which is out of bounds (max
        // 887103); the DES=...; form forces the SPK-ID branch. JPL's parser
        // also rejects literal ';' in queries, so the whole value must be
        // form-encoded; we assert the encoded fragments.
        server.expect(requestUrlContains("COMMAND="))
              .andExpect(method(HttpMethod.GET))
              .andExpect(requestUrlContains("DES%3D2000433")) // DES=2000433 form-encoded
              .andExpect(requestUrlContains("%3B"))            // trailing semicolon
              .andExpect(requestUrlContains("CENTER="))
              .andExpect(requestUrlContains("%4010"))          // '@10' form-encoded
              .andExpect(requestUrlContains("OUT_UNITS="))
              .andRespond(withSuccess(capturedResponse, MediaType.TEXT_PLAIN));

        HorizonsResponseParser.State state =
            client.fetchState("2000433", AbsoluteDate.J2000_EPOCH);

        assertNotNull(state);
        // Sanity: same magnitudes as the parser test.
        assertTrue(state.position().getNorm() > 1e11);
        assertTrue(state.velocity().getNorm() > 1e4);
        server.verify();
    }

    @Test
    void throwsHorizonsFetchExceptionOnEmptyBody() {
        server.expect(requestUrlContains("COMMAND="))
              .andRespond(withSuccess("", MediaType.TEXT_PLAIN));

        assertThrows(HorizonsClient.HorizonsFetchException.class,
            () -> client.fetchState("2000433", AbsoluteDate.J2000_EPOCH));
    }

    @Test
    void serializesRequestsAcrossThreads() throws Exception {
        // JPL Horizons explicitly asks clients to submit "only one API
        // request at a time" — see API docs. Our cache serializes per-key
        // fetches (computeIfAbsent), but distinct keys would otherwise race
        // when multiple users submit cold sims simultaneously. The
        // semaphore around the HTTP call enforces the rule globally.
        //
        // Test: N threads call fetchState concurrently. The mock response
        // handler observes how many threads are inside the HTTP call at
        // once; with serialization in place, peak concurrency must be 1.
        final int N = 8;
        AtomicInteger inFlight = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();

        // Rebuild client + mock with ignoreExpectOrder(true) so the mock
        // server accepts overlapping requests from different threads.
        RestClient.Builder builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).ignoreExpectOrder(true).build();
        client = new HorizonsClient(builder);

        server.expect(ExpectedCount.times(N), requestUrlContains("COMMAND="))
              .andRespond(request -> {
                  int now = inFlight.incrementAndGet();
                  peak.accumulateAndGet(now, Math::max);
                  try {
                      // Sleep long enough that overlapping calls would be
                      // detectable; short enough that the test stays quick.
                      Thread.sleep(50);
                  } catch (InterruptedException e) {
                      Thread.currentThread().interrupt();
                  } finally {
                      inFlight.decrementAndGet();
                  }
                  org.springframework.mock.http.client.MockClientHttpResponse resp =
                      new org.springframework.mock.http.client.MockClientHttpResponse(
                          capturedResponse.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                          org.springframework.http.HttpStatus.OK);
                  resp.getHeaders().setContentType(MediaType.TEXT_PLAIN);
                  return resp;
              });

        ExecutorService exec = Executors.newFixedThreadPool(N);
        CountDownLatch ready = new CountDownLatch(N);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (int i = 0; i < N; i++) {
            final int idx = i;
            futures.add(exec.submit(() -> {
                ready.countDown();
                go.await();
                // Distinct epochs so each call misses the (per-key) cache.
                client.fetchState("2000433",
                    AbsoluteDate.J2000_EPOCH.shiftedBy(idx * 86400.0));
                return null;
            }));
        }
        ready.await(5, TimeUnit.SECONDS);
        go.countDown();
        exec.shutdown();
        assertTrue(exec.awaitTermination(30, TimeUnit.SECONDS),
            "Threads did not finish in time");
        for (Future<?> f : futures) f.get();  // surface any thread-side failure

        assertEquals(1, peak.get(),
            "Peak concurrent JPL requests must be 1; got " + peak.get());
    }

    @Test
    void parseFailureSurfacesJplErrorBodyInException() {
        // When JPL returns a non-ephemeris body (e.g. "No ephemeris for
        // target ..."), the parser throws IllegalArgumentException. The
        // message must include enough of the body that the JPL error is
        // visible in logs — debugging this class of bug from "missing
        // $$SOE markers" alone was painful.
        String jplError =
            "API VERSION: 1.2\nAPI SOURCE: NASA/JPL Horizons API\n\n" +
            "No ephemeris for target \"\" after A.D. 2009-DEC-31 00:00:00.0000 TDB";
        server.expect(requestUrlContains("COMMAND="))
              .andRespond(withSuccess(jplError, MediaType.TEXT_PLAIN));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> client.fetchState("2000433", AbsoluteDate.J2000_EPOCH));
        assertTrue(ex.getMessage().contains("No ephemeris"),
            "Expected JPL error body in exception message, got: " + ex.getMessage());
    }

    /** Helper: match any request whose URL string contains the given substring. */
    private static RequestMatcher requestUrlContains(String substring) {
        return requestTo(containsString(substring));
    }
}
