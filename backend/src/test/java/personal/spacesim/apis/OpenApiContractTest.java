package personal.spacesim.apis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Pins the generated OpenAPI spec to the committed backend/openapi.json.
 *
 * <p>Assert mode (default): fails if the committed file differs from what
 * springdoc currently produces — i.e. a DTO/endpoint changed but the spec
 * wasn't regenerated. This is the backend half of the cross-language drift
 * gate (the frontend's api.ts is generated from this same file).
 *
 * <p>Write mode (-Dopenapi.write=true): overwrites backend/openapi.json and
 * passes. This is the regeneration command after an intentional API change.
 *
 * <p>The spec is normalized through a deterministic ObjectMapper (sorted keys,
 * indented) so the committed file is byte-stable across regenerations and the
 * git-diff gate doesn't false-positive. Generation uses MockMvc (no real port)
 * to avoid leaking a random host:port into the spec's `servers` block.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
class OpenApiContractTest {

    // Resolved relative to the backend module dir (Maven sets user.dir to the
    // module root when running tests).
    private static final Path SPEC_FILE = Path.of("openapi.json");

    private static final ObjectMapper CANONICAL = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true)
            .enable(SerializationFeature.INDENT_OUTPUT);

    @Autowired
    private MockMvc mockMvc;

    @Test
    void committedSpecMatchesGenerated() throws Exception {
        String raw = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        // Normalize: parse then re-serialize with sorted keys + indentation,
        // and strip the volatile `servers` block if present.
        JsonNode tree = CANONICAL.readTree(raw);
        if (tree.has("servers")) {
            ((com.fasterxml.jackson.databind.node.ObjectNode) tree).remove("servers");
        }
        String canonical = CANONICAL.writeValueAsString(tree) + "\n";

        if (Boolean.getBoolean("openapi.write")) {
            Files.writeString(SPEC_FILE, canonical);
            return;
        }

        assertTrue(Files.exists(SPEC_FILE),
                "backend/openapi.json missing. Regenerate: "
                        + "./mvnw test -Dtest=OpenApiContractTest -Dopenapi.write=true");
        String committed = Files.readString(SPEC_FILE);
        assertEquals(committed, canonical,
                "OpenAPI spec drifted from the code. Regenerate the contract: "
                        + "(1) ./mvnw test -Dtest=OpenApiContractTest -Dopenapi.write=true "
                        + "(2) cd ../frontend && npm run gen:api, then commit both files.");
    }
}
