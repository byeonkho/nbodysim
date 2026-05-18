package personal.spacesim.services;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(SpringExtension.class)
@SpringBootTest
class SimulationSessionServiceTest {

    @Autowired
    private SimulationSessionService service;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationSessionServiceTest.class.getClassLoader()
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
    void firstCallReturnsChunkAndKicksOffPrecompute()
            throws InterruptedException, ExecutionException, TimeoutException {
        // Tiny sim — 1 body, EULER. Keeps the test under a few seconds.
        String sessionID = service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "days",
                1
        );

        byte[] first = service.getNextChunkBytes(sessionID);
        assertNotNull(first);
        assertTrue(first.length > 0);

        // Precompute should be running (or already done).
        CompletableFuture<byte[]> nextFuture = service.peekPrecomputedChunk(sessionID);
        assertNotNull(nextFuture, "expected precompute to be kicked off after first call");

        // Wait up to 30s for precompute to complete — generous since CI cold-start
        // can be slow. Failing the timeout means precompute wasn't actually submitted.
        byte[] precomputed = nextFuture.get(30, TimeUnit.SECONDS);
        assertNotNull(precomputed);
        assertTrue(precomputed.length > 0);
    }

    @Test
    void secondCallReturnsPrecomputedChunk()
            throws InterruptedException, ExecutionException, TimeoutException {
        String sessionID = service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "days",
                1
        );

        service.getNextChunkBytes(sessionID);
        // Force precompute to settle.
        service.peekPrecomputedChunk(sessionID).get(30, TimeUnit.SECONDS);

        long t0 = System.nanoTime();
        byte[] second = service.getNextChunkBytes(sessionID);
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertNotNull(second);
        assertTrue(second.length > 0);
        // Cache hit path is byte-copy + post-compute submit; should be < 500ms
        // even on slow CI. The fresh compute path takes seconds.
        assertTrue(elapsedMs < 500,
                "expected cache hit < 500ms, got " + elapsedMs + "ms");
    }
}
