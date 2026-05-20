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
        // Request matcher: the URL must contain COMMAND='2000433' (URL-encoded
        // single quotes will appear as %27).
        server.expect(requestUrlContains("COMMAND="))
              .andExpect(method(HttpMethod.GET))
              .andExpect(requestUrlContains("2000433"))
              .andExpect(requestUrlContains("CENTER="))
              .andExpect(requestUrlContains("@10"))   // heliocentric body code
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

    /** Helper: match any request whose URL string contains the given substring. */
    private static RequestMatcher requestUrlContains(String substring) {
        return requestTo(containsString(substring));
    }
}
