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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@ExtendWith(SpringExtension.class)
@SpringBootTest
@AutoConfigureMockMvc
class GroundTruthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SimulationSessionService sessionService;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = GroundTruthControllerTest.class.getClassLoader()
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

    @Test
    void returnsTracksForKnownSession() throws Exception {
        AbsoluteDate start = new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        String sessionId = sessionService.createSimulation(
                List.of("Sun", "Earth", "Mars"), "ICRF", "EULER", start, "seconds", 1, 5000);

        long fromMs = start.toDate(TimeScalesFactory.getUTC()).getTime();
        long toMs = start.shiftedBy(10 * 86_400.0).toDate(TimeScalesFactory.getUTC()).getTime();

        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("sessionId", sessionId)
                        .param("fromEpoch", String.valueOf(fromMs))
                        .param("toEpoch", String.valueOf(toMs)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tracks").isArray())
                // Earth + Mars; Sun is excluded.
                .andExpect(jsonPath("$.tracks.length()").value(2))
                .andExpect(jsonPath("$.tracks[0].anchors").isArray());
    }

    @Test
    void unknownSessionReturns404() throws Exception {
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("sessionId", "does-not-exist")
                        .param("fromEpoch", "0")
                        .param("toEpoch", "86400000"))
                .andExpect(status().isNotFound());
    }

    @Test
    void reversedWindowReturns400() throws Exception {
        AbsoluteDate start = new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        String sessionId = sessionService.createSimulation(
                List.of("Sun", "Earth", "Mars"), "ICRF", "EULER", start, "seconds", 1, 5000);

        long fromMs = start.toDate(TimeScalesFactory.getUTC()).getTime();
        long toMs = start.shiftedBy(10 * 86_400.0).toDate(TimeScalesFactory.getUTC()).getTime();

        // fromEpoch > toEpoch — reversed window should be rejected
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("sessionId", sessionId)
                        .param("fromEpoch", String.valueOf(toMs))
                        .param("toEpoch", String.valueOf(fromMs)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void oversizedWindowReturns400() throws Exception {
        AbsoluteDate start = new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        String sessionId = sessionService.createSimulation(
                List.of("Sun", "Earth", "Mars"), "ICRF", "EULER", start, "seconds", 1, 5000);

        long fromMs = start.toDate(TimeScalesFactory.getUTC()).getTime();
        // ~900 days — well above the 800-day cap
        long toMs = fromMs + 900L * 24 * 60 * 60 * 1000;

        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("sessionId", sessionId)
                        .param("fromEpoch", String.valueOf(fromMs))
                        .param("toEpoch", String.valueOf(toMs)))
                .andExpect(status().isBadRequest());
    }
}
