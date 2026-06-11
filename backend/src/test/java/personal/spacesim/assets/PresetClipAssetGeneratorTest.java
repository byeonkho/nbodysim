package personal.spacesim.assets;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import personal.spacesim.constants.FidelityBucket;
import personal.spacesim.dtos.SimulationResponseDTO;
import personal.spacesim.services.SimulationSessionService;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Write-only generator for the precomputed default-sim static clip. Runs only
 * under -Ddefaultsim.write=true so it never executes (or writes) in a normal
 * test run. It captures the default solar-system /initialize response plus the
 * first {@link #CHUNK_COUNT} chunk payloads and packs them into the bundle the
 * frontend serves from the edge.
 *
 * <p>Regenerate after changing the default preset (or the wire format):
 * <pre>./mvnw test -Dtest=DefaultSimAssetGeneratorTest -Ddefaultsim.write=true</pre>
 * The frontend staleness guard fails CI until this is rerun and the asset
 * committed. These constants mirror the frontend default preset (runPreset.ts +
 * MobilePresets.ts); that guard is what pins them together.
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "defaultsim.write", matches = "true")
class DefaultSimAssetGeneratorTest {

    private static final String EPOCH = "2024-06-05T00:00:00.000";
    private static final String INTEGRATOR = "rk4";
    // The params block stores the display LABEL (matches the frontend
    // DEFAULT_FRAME the guard compares against); createSimulation takes the code.
    private static final String FRAME_LABEL = "Heliocentric";
    private static final String FRAME_CODE = "heliocentric";
    private static final String TIME_UNIT = "Hours";
    private static final FidelityBucket BUCKET = FidelityBucket.MED_LOW;
    private static final List<String> BODIES = List.of(
            "Sun", "Mercury", "Venus", "Earth", "Mars",
            "Jupiter", "Saturn", "Uranus", "Neptune", "Moon");
    // ~1.14 sim-years per chunk (10k hourly steps, kept 1-in-10); 6 ≈ 6.8 years.
    private static final int CHUNK_COUNT = 6;

    // Relative to the backend module dir (Maven sets user.dir to the module root).
    private static final Path ASSET =
            Path.of("..", "frontend", "public", "default-sim-v3.bin");

    @Autowired
    private SimulationSessionService service;

    // The Spring-configured mapper, so the body-list JSON serializes exactly as
    // the live /initialize endpoint does (no plain-ObjectMapper drift).
    @Autowired
    private ObjectMapper mapper;

    @Test
    void writeBundle() throws Exception {
        AbsoluteDate date = new AbsoluteDate(EPOCH, TimeScalesFactory.getUTC());
        String sessionID = service.createSimulation(
                BODIES, FRAME_CODE, INTEGRATOR, date, TIME_UNIT,
                BUCKET.keyframesPerKept(), BUCKET.targetSnapshotsPerChunk());

        SimulationResponseDTO init = service.returnSimulationResponseDTO(sessionID);

        List<byte[]> chunks = new ArrayList<>(CHUNK_COUNT);
        for (int i = 0; i < CHUNK_COUNT; i++) {
            chunks.add(service.getNextChunkBytes(sessionID));
        }
        service.removeSimulation(sessionID);

        ObjectNode manifest = mapper.createObjectNode();
        ObjectNode params = manifest.putObject("params");
        params.put("formatVersion", BinaryResponseSerializer.FORMAT_VERSION);
        params.put("epoch", EPOCH);
        params.put("integrator", INTEGRATOR);
        params.put("frame", FRAME_LABEL);
        params.put("timeStepUnit", TIME_UNIT);
        params.put("fidelityBucket", BUCKET.wireName());
        params.put("chunkCount", CHUNK_COUNT);
        ArrayNode bodies = params.putArray("bodies");
        BODIES.stream().sorted().forEach(bodies::add);
        manifest.set("celestialBodyPropertiesList",
                mapper.valueToTree(init.celestialBodyPropertiesList()));

        byte[] manifestBytes = mapper.writeValueAsBytes(manifest);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(u32le(manifestBytes.length));
        out.write(manifestBytes);
        for (byte[] chunk : chunks) {
            out.write(u32le(chunk.length));
            out.write(chunk);
        }
        byte[] bundle = out.toByteArray();

        Files.createDirectories(ASSET.getParent());
        Files.write(ASSET, bundle);

        assertTrue(Files.exists(ASSET), "bundle written");
        assertTrue(bundle.length > 0, "bundle non-empty");
        assertEquals(CHUNK_COUNT, chunks.size(), "collected all chunks");
        System.out.printf(
                "[default-sim] wrote %s: %d chunks, %.1f KB, ~%.1f sim-years%n",
                ASSET.toAbsolutePath().normalize(), CHUNK_COUNT,
                bundle.length / 1024.0, CHUNK_COUNT * 10_000.0 / 24.0 / 365.25);
    }

    private static byte[] u32le(int v) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array();
    }
}
