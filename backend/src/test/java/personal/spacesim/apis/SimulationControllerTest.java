package personal.spacesim.apis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import org.springframework.test.web.servlet.MockMvc;

import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.services.SessionCapacityExceededException;
import personal.spacesim.services.GroundTruthProvider;
import personal.spacesim.apis.controller.SimulationController;
import personal.spacesim.simulation.frame.CustomFrameFactory;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

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
    void chunkComputeSaturationReturns503() throws Exception {
        SimulationSessionService saturated = mock(SimulationSessionService.class);
        when(saturated.getNextChunkBytes("busy", 0))
                .thenThrow(new SessionCapacityExceededException("busy"));
        var controller = new SimulationController(
                saturated,
                mock(GroundTruthProvider.class),
                mock(CustomFrameFactory.class));
        standaloneSetup(controller).build()
                .perform(post("/api/simulation/chunk")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionID\":\"busy\",\"expectedChunkIndex\":0}"))
                .andExpect(status().isServiceUnavailable());
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
                .andExpect(content().contentType(MediaType.APPLICATION_OCTET_STREAM))
                .andExpect(result -> {
                    byte[] body = result.getResponse().getContentAsByteArray();
                    if (body.length == 0) throw new AssertionError("expected chunk bytes");
                });
    }

    @Test
    void initializeResponseKeepsPublicJsonShape() throws Exception {
        String body = """
                {
                  "celestialBodyNames": ["Sun", "Earth"],
                  "date": "2024-01-01T00:00:00.000",
                  "frame": "ICRF",
                  "integrator": "EULER",
                  "timeStepUnit": "days",
                  "fidelityBucket": null
                }
                """;

        mockMvc.perform(post("/api/simulation/initialize")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.celestialBodyPropertiesList.length()").value(2))
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].name").value("SUN"))
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].mass").isNumber())
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].mu").isNumber())
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].radius").isNumber())
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].position").doesNotExist())
                .andExpect(jsonPath("$.celestialBodyPropertiesList[0].velocity").doesNotExist())
                .andExpect(jsonPath("$.simulationMetaData.sessionID").isString());
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

    @ParameterizedTest
    @ValueSource(strings = {
            "[\"Sun\",\"Earth\",\"earth\"]",
            "[\"Sun\",\"Ceres\",\"CERES\"]"
    })
    void initializeRejectsCaseInsensitiveDuplicateBodiesBeforeSideEffects(
            String bodyNamesJson
    ) throws Exception {
        String prior = liveSession();
        int sessionCountBefore = service.getAllSimulations().size();
        String body = "{"
                + "\"celestialBodyNames\":" + bodyNamesJson + ","
                + "\"date\":\"2024-01-01T00:00:00.000\","
                + "\"frame\":\"ICRF\","
                + "\"integrator\":\"EULER\","
                + "\"timeStepUnit\":\"days\","
                + "\"fidelityBucket\":null,"
                + "\"previousSessionID\":\"" + prior + "\"}";

        mockMvc.perform(post("/api/simulation/initialize")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(""));

        assertEquals(sessionCountBefore, service.getAllSimulations().size(),
                "duplicate rejection must not create a session");
        assertNotNull(service.getSimulation(prior),
                "duplicate rejection must not release the prior session");
    }
}
