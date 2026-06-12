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
 * Write-only generator for the precomputed preset clips. Runs only under
 * -Dpresetclip.write=true so it never executes (or writes) in a normal test
 * run. For each canonical preset (the builders' untouched default selection
 * plus the catalog quick-selects) it captures the /initialize response plus
 * the preset's chunk payloads and packs them into the bundle the frontend
 * serves from the edge.
 *
 * <p>Side effect worth knowing: generating the moon / minor-body presets
 * populates the local Horizons disk cache with every (body, default-epoch)
 * state the catalog needs — exactly the files the classpath prebake ships
 * (see horizons-prebaked/ in main resources).
 *
 * <p>Regenerate after changing a preset (or the wire format):
 * <pre>./mvnw test -Dtest=PresetClipAssetGeneratorTest -Dpresetclip.write=true</pre>
 * The frontend staleness guard fails CI until this is rerun and the assets
 * committed. The preset table mirrors the frontend CLIP_PRESETS registry
 * (ClipPresets.ts); that guard is what pins them together.
 */
@SpringBootTest
@EnabledIfSystemProperty(named = "presetclip.write", matches = "true")
class PresetClipAssetGeneratorTest {

    private static final String EPOCH = "2024-06-05T00:00:00.000";
    private static final String INTEGRATOR = "rk4";
    // The params block stores the display LABEL (matches the frontend
    // DEFAULT_FRAME the guard compares against); createSimulation takes the code.
    private static final String FRAME_LABEL = "Heliocentric";
    private static final String FRAME_CODE = "heliocentric";
    private static final String TIME_UNIT = "Hours";
    private static final FidelityBucket BUCKET = FidelityBucket.MED_LOW;
    // ~1.14 sim-years per chunk (10k hourly steps, kept 1-in-10); 6 ≈ 6.8 years.
    // The 40-body full catalog ships 4 chunks instead so its decoded size
    // stays well inside the lowMem client budget (assertion below).
    private static final int DEFAULT_CHUNK_COUNT = 6;
    // Kept samples per chunk under MED_LOW K=10 thinning (10k steps / 10).
    private static final int SAMPLES_PER_CHUNK = 1_000;
    // The mobile (lowMem) client chunk-buffer budget. Every clip must decode
    // to at most 80% of this so every client can hold every clip with
    // headroom; the frontend's runStaticClip budget guard is the backstop,
    // not the plan. 6 float64 components per body-sample.
    private static final long LOW_MEM_BUDGET_BYTES = 12L * 1024 * 1024;

    private record Preset(String id, int chunkCount, List<String> bodies) {}

    // Mirrors CLIP_PRESETS on the frontend: the "default" untouched builder
    // selection (DEFAULT_SELECTED) plus the catalog quick-selects
    // (BodyCatalog.ts PRESETS).
    private static final List<Preset> PRESETS = List.of(
            new Preset("default", DEFAULT_CHUNK_COUNT, List.of(
                    "Sun", "Mercury", "Venus", "Earth", "Mars",
                    "Jupiter", "Saturn", "Uranus", "Neptune", "Moon")),
            new Preset("inner", DEFAULT_CHUNK_COUNT, List.of(
                    "Sun", "Mercury", "Venus", "Earth", "Moon",
                    "Mars", "Phobos", "Deimos")),
            new Preset("giants", DEFAULT_CHUNK_COUNT, List.of(
                    "Sun",
                    "Jupiter", "Io", "Europa", "Ganymede", "Callisto",
                    "Saturn", "Mimas", "Enceladus", "Tethys", "Dione",
                    "Rhea", "Titan", "Iapetus",
                    "Uranus", "Ariel", "Umbriel", "Titania", "Oberon", "Miranda",
                    "Neptune", "Triton", "Nereid")),
            new Preset("neos", DEFAULT_CHUNK_COUNT, List.of(
                    "Sun", "Earth", "Eros", "Apophis", "Bennu", "Ryugu")),
            // 4 chunks (~4.6 sim-years): 6 would decode to ~11.5 MB on the
            // client, 92% of the lowMem buffer budget.
            new Preset("full", 4, List.of(
                    "Sun", "Mercury", "Venus", "Earth", "Mars",
                    "Jupiter", "Saturn", "Uranus", "Neptune",
                    "Moon", "Phobos", "Deimos",
                    "Io", "Europa", "Ganymede", "Callisto",
                    "Mimas", "Enceladus", "Tethys", "Dione", "Rhea",
                    "Titan", "Iapetus",
                    "Miranda", "Ariel", "Umbriel", "Titania", "Oberon",
                    "Triton", "Nereid", "Charon", "Pluto",
                    "Ceres", "Vesta", "Pallas", "Hygiea",
                    "Eros", "Apophis", "Bennu", "Ryugu")));

    // Relative to the backend module dir (Maven sets user.dir to the module root).
    private static final Path PUBLIC_DIR = Path.of("..", "frontend", "public");

    @Autowired
    private SimulationSessionService service;

    // The Spring-configured mapper, so the body-list JSON serializes exactly as
    // the live /initialize endpoint does (no plain-ObjectMapper drift).
    @Autowired
    private ObjectMapper mapper;

    @Test
    void writeBundles() throws Exception {
        for (Preset preset : PRESETS) {
            writeBundle(preset);
        }
    }

    private void writeBundle(Preset preset) throws Exception {
        long decodedBytes =
                (long) preset.chunkCount() * SAMPLES_PER_CHUNK * preset.bodies().size() * 6 * 8;
        assertTrue(decodedBytes <= LOW_MEM_BUDGET_BYTES * 8 / 10,
                preset.id() + " clip would decode to " + decodedBytes
                        + " bytes, above 80% of the lowMem client buffer budget");

        AbsoluteDate date = new AbsoluteDate(EPOCH, TimeScalesFactory.getUTC());
        String sessionID = service.createSimulation(
                preset.bodies(), FRAME_CODE, INTEGRATOR, date, TIME_UNIT,
                BUCKET.keyframesPerKept(), BUCKET.targetSnapshotsPerChunk());

        SimulationResponseDTO init = service.returnSimulationResponseDTO(sessionID);

        List<byte[]> chunks = new ArrayList<>(preset.chunkCount());
        for (int i = 0; i < preset.chunkCount(); i++) {
            chunks.add(service.getNextChunkBytes(sessionID));
        }
        service.removeSimulation(sessionID);

        ObjectNode manifest = mapper.createObjectNode();
        ObjectNode params = manifest.putObject("params");
        params.put("formatVersion", BinaryResponseSerializer.FORMAT_VERSION);
        params.put("presetId", preset.id());
        params.put("epoch", EPOCH);
        params.put("integrator", INTEGRATOR);
        params.put("frame", FRAME_LABEL);
        params.put("timeStepUnit", TIME_UNIT);
        params.put("fidelityBucket", BUCKET.wireName());
        params.put("chunkCount", preset.chunkCount());
        // Pinned by the frontend staleness guard against CLIP_SAMPLES_PER_CHUNK:
        // the client budget guard estimates decoded size from that constant, so
        // a backend chunk-size or thinning change must fail CI, not silently
        // mis-size the buffer.
        params.put("samplesPerChunk", SAMPLES_PER_CHUNK);
        ArrayNode bodies = params.putArray("bodies");
        preset.bodies().stream().sorted().forEach(bodies::add);
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

        Path asset = PUBLIC_DIR.resolve("clip-" + preset.id() + "-v3.bin");
        Files.createDirectories(asset.getParent());
        Files.write(asset, bundle);

        assertTrue(Files.exists(asset), "bundle written");
        assertTrue(bundle.length > 0, "bundle non-empty");
        assertEquals(preset.chunkCount(), chunks.size(), "collected all chunks");
        System.out.printf(
                "[preset-clip] wrote %s: %d bodies, %d chunks, %.1f KB, ~%.1f sim-years%n",
                asset.toAbsolutePath().normalize(), preset.bodies().size(), preset.chunkCount(),
                bundle.length / 1024.0, preset.chunkCount() * 10_000.0 / 24.0 / 365.25);
    }

    private static byte[] u32le(int v) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array();
    }
}
