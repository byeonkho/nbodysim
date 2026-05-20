package personal.spacesim.simulation.body.horizons;

import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Thin HTTP client over the JPL Horizons CGI API. Fetches a single-epoch
 * state vector for a body identified by its SPK ID, in heliocentric ICRF.
 *
 * <p>Heliocentric ({@code CENTER='@10'} — body 10 is the Sun) matches the
 * Sun-relative shifting done elsewhere in the simulation pipeline. The
 * returned state can be packed directly into the integrator buffer
 * alongside Orekit-sourced major-planet states without further frame
 * conversion.
 *
 * <p>This runs at sim-submit time (once per minor body, wrapped by
 * {@link HorizonsStateCache}), not per timestep, so the HTTP/JSON cost
 * is irrelevant to the integrator hot path.
 */
@Component
public class HorizonsClient {

    private static final String API_BASE = "https://ssd.jpl.nasa.gov/api/horizons.api";
    private static final DateTimeFormatter HORIZONS_DT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final RestClient http;

    public HorizonsClient(RestClient.Builder builder) {
        this.http = builder.baseUrl(API_BASE).build();
    }

    public HorizonsResponseParser.State fetchState(String spkId, AbsoluteDate epoch) {
        String startTime = formatEpoch(epoch);
        String stopTime  = formatEpoch(epoch.shiftedBy(60.0));  // 1-minute window

        String body;
        try {
            body = http.get()
                .uri(uriBuilder -> uriBuilder
                    .queryParam("format", "text")
                    .queryParam("COMMAND", "'" + spkId + "'")
                    .queryParam("OBJ_DATA", "'NO'")
                    .queryParam("MAKE_EPHEM", "'YES'")
                    .queryParam("EPHEM_TYPE", "'VECTORS'")
                    .queryParam("CENTER", "'@10'")
                    .queryParam("START_TIME", "'" + startTime + "'")
                    .queryParam("STOP_TIME",  "'" + stopTime + "'")
                    .queryParam("STEP_SIZE", "'1'")
                    .queryParam("OUT_UNITS", "'KM-S'")
                    .queryParam("REF_PLANE", "'FRAME'")
                    .queryParam("REF_SYSTEM", "'ICRF'")
                    .queryParam("VEC_TABLE", "'2'")
                    .build())
                .retrieve()
                .body(String.class);
        } catch (RestClientException ex) {
            throw new HorizonsFetchException(
                "Failed to fetch state for SPK " + spkId + " at " + epoch, ex);
        }
        if (body == null || body.isEmpty()) {
            throw new HorizonsFetchException(
                "Empty Horizons response for SPK " + spkId);
        }
        return HorizonsResponseParser.parseFirstRecord(body);
    }

    private String formatEpoch(AbsoluteDate date) {
        // Horizons accepts dates in "yyyy-MM-dd HH:mm" UTC.
        // AbsoluteDate.toString(UTC) returns "yyyy-MM-ddTHH:mm:ss.sss".
        String iso = date.toString(TimeScalesFactory.getUTC());
        LocalDateTime ldt = LocalDateTime.parse(iso);
        return ldt.format(HORIZONS_DT);
    }

    public static class HorizonsFetchException extends RuntimeException {
        public HorizonsFetchException(String msg) { super(msg); }
        public HorizonsFetchException(String msg, Throwable cause) { super(msg, cause); }
    }
}
