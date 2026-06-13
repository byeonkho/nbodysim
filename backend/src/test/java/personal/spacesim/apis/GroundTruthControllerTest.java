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

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The endpoint is sessionless: ground truth is public ephemeris, and preset
 * clip playback (which has no session) needs the drift overlay too. body and
 * frame arrive as request params instead of being derived from a session.
 */
@ExtendWith(SpringExtension.class)
@SpringBootTest
@AutoConfigureMockMvc
class GroundTruthControllerTest {

    @Autowired
    private MockMvc mockMvc;

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

    private static long[] tenDayWindow() {
        AbsoluteDate start =
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC());
        long fromMs = start.toDate(TimeScalesFactory.getUTC()).getTime();
        long toMs = start.shiftedBy(10 * 86_400.0)
                .toDate(TimeScalesFactory.getUTC()).getTime();
        return new long[]{fromMs, toMs};
    }

    @Test
    void returnsTrackForRequestedBody() throws Exception {
        long[] w = tenDayWindow();
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "EARTH")
                        .param("frame", "ICRF")
                        .param("fromEpoch", String.valueOf(w[0]))
                        .param("toEpoch", String.valueOf(w[1])))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tracks").isArray())
                .andExpect(jsonPath("$.tracks.length()").value(1))
                .andExpect(jsonPath("$.tracks[0].anchors").isArray());
    }

    @Test
    void acceptsSubtractSunParam() throws Exception {
        long[] w = tenDayWindow();
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "EARTH")
                        .param("frame", "ICRF")
                        .param("fromEpoch", String.valueOf(w[0]))
                        .param("toEpoch", String.valueOf(w[1]))
                        .param("subtractSun", "false"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tracks.length()").value(1));
    }

    @Test
    void unsupportedBodyReturnsEmptyTracks() throws Exception {
        long[] w = tenDayWindow();
        // Io is a moon (no Sun-orbiting DE-440 coverage): filtered to an empty
        // response rather than an error, matching the previous session-based
        // behavior for unsupported bodies.
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "Io")
                        .param("frame", "ICRF")
                        .param("fromEpoch", String.valueOf(w[0]))
                        .param("toEpoch", String.valueOf(w[1])))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tracks.length()").value(0));
    }

    @Test
    void unknownFrameReturns400() throws Exception {
        long[] w = tenDayWindow();
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "EARTH")
                        .param("frame", "barycentric-nonsense")
                        .param("fromEpoch", String.valueOf(w[0]))
                        .param("toEpoch", String.valueOf(w[1])))
                .andExpect(status().isBadRequest());
    }

    @Test
    void reversedWindowReturns400() throws Exception {
        long[] w = tenDayWindow();
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "EARTH")
                        .param("frame", "ICRF")
                        .param("fromEpoch", String.valueOf(w[1]))
                        .param("toEpoch", String.valueOf(w[0])))
                .andExpect(status().isBadRequest());
    }

    @Test
    void oversizedWindowReturns400() throws Exception {
        long[] w = tenDayWindow();
        // ~4000 years, above the generous sanity cap (garbage input).
        long toMs = w[0] + 4000L * 365 * 24 * 60 * 60 * 1000;
        mockMvc.perform(get("/api/simulation/ground-truth")
                        .param("body", "EARTH")
                        .param("frame", "ICRF")
                        .param("fromEpoch", String.valueOf(w[0]))
                        .param("toEpoch", String.valueOf(toMs)))
                .andExpect(status().isBadRequest());
    }
}
