package personal.spacesim.apis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.web.servlet.MockMvc;

import personal.spacesim.services.SimulationSessionService;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(SpringExtension.class)
@SpringBootTest
@AutoConfigureMockMvc
class SimulationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SimulationSessionService service;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationControllerTest.class.getClassLoader()
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

    private String liveSession() {
        return service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "days",
                1,
                5000
        );
    }

    @Test
    void chunkForUnknownSessionReturns410() throws Exception {
        mockMvc.perform(post("/api/simulation/chunk")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionID\":\"no-such-session\",\"expectedChunkIndex\":0}"))
                .andExpect(status().isGone());
    }

    @Test
    void chunkWithOutOfStepIndexReturns409() throws Exception {
        String sessionID = liveSession();
        mockMvc.perform(post("/api/simulation/chunk")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionID\":\"" + sessionID + "\",\"expectedChunkIndex\":5}"))
                .andExpect(status().isConflict());
    }

    @Test
    void chunkFirstRequestReturns200Octet() throws Exception {
        String sessionID = liveSession();
        mockMvc.perform(post("/api/simulation/chunk")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionID\":\"" + sessionID + "\",\"expectedChunkIndex\":0}"))
                .andExpect(status().isOk())
                .andExpect(result -> {
                    byte[] body = result.getResponse().getContentAsByteArray();
                    if (body.length == 0) throw new AssertionError("expected chunk bytes");
                });
    }

    @Test
    void initializeWithPreviousSessionReleasesIt() throws Exception {
        String prior = liveSession();
        String body = "{"
                + "\"celestialBodyNames\":[\"Sun\",\"Earth\"],"
                + "\"date\":\"2024-01-01T00:00:00.000\","
                + "\"frame\":\"ICRF\","
                + "\"integrator\":\"EULER\","
                + "\"timeStepUnit\":\"days\","
                + "\"fidelityBucket\":null,"
                + "\"previousSessionID\":\"" + prior + "\"}";
        mockMvc.perform(post("/api/simulation/initialize")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());

        // The prior session is now gone: a chunk request for it returns 410.
        mockMvc.perform(post("/api/simulation/chunk")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionID\":\"" + prior + "\",\"expectedChunkIndex\":0}"))
                .andExpect(status().isGone());
    }
}
