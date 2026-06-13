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
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
                /* keyframesPerKept= */ 1,
                /* targetSnapshotsPerChunk= */ 5000
        );

        byte[] first = service.getNextChunkBytes(sessionID, 0);
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
                /* keyframesPerKept= */ 1,
                /* targetSnapshotsPerChunk= */ 5000
        );

        service.getNextChunkBytes(sessionID, 0);
        // Force precompute to settle.
        service.peekPrecomputedChunk(sessionID).get(30, TimeUnit.SECONDS);

        long t0 = System.nanoTime();
        byte[] second = service.getNextChunkBytes(sessionID, 1);
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertNotNull(second);
        assertTrue(second.length > 0);
        // Cache hit path is byte-copy + post-compute submit; should be < 500ms
        // even on slow CI. The fresh compute path takes seconds.
        assertTrue(elapsedMs < 500,
                "expected cache hit < 500ms, got " + elapsedMs + "ms");
    }

    private String tinyEulerSession() {
        return service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "days",
                /* keyframesPerKept= */ 1,
                /* targetSnapshotsPerChunk= */ 5000
        );
    }

    @Test
    void concurrentSameIndexRequestsReserveOneChunkAndAdvanceOnce() throws Exception {
        String sessionID = tinyEulerSession();

        int n = 8;
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch ready = new CountDownLatch(n);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<byte[]>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < n; i++) {
                futures.add(pool.submit((Callable<byte[]>) () -> {
                    ready.countDown();
                    go.await();
                    return service.getNextChunkBytes(sessionID, 0);
                }));
            }
            ready.await();
            go.countDown();

            byte[] first = futures.get(0).get();
            assertNotNull(first);
            assertTrue(first.length > 0);
            // All concurrent index-0 requests must yield byte-identical chunk 0:
            // exactly one produced, the rest re-served. A racy implementation would
            // run() multiple times and return divergent bytes.
            for (Future<byte[]> f : futures) {
                assertArrayEquals(first, f.get(),
                        "all concurrent index-0 requests must re-serve identical bytes");
            }
        } finally {
            pool.shutdownNow();
        }

        // Cursor advanced exactly once: index 1 is the next valid chunk and differs
        // from chunk 0. A double-advance would have skipped or corrupted it.
        byte[] chunk1 = service.getNextChunkBytes(sessionID, 1);
        assertNotNull(chunk1);
        assertTrue(chunk1.length > 0);
        assertFalse(Arrays.equals(futures.get(0).get(), chunk1));
    }

    @Test
    void reservesLastChunkOnMatchingIndexAndConflictsOtherwise()
            throws Exception {
        String sessionID = tinyEulerSession();

        byte[] c0 = service.getNextChunkBytes(sessionID, 0);
        // Let the index-1 precompute settle so the re-serve path is exercised.
        service.peekPrecomputedChunk(sessionID).get(30, TimeUnit.SECONDS);

        byte[] c1a = service.getNextChunkBytes(sessionID, 1);
        byte[] c1b = service.getNextChunkBytes(sessionID, 1); // re-serve, no advance
        assertArrayEquals(c1a, c1b);
        assertFalse(Arrays.equals(c0, c1a));

        // served == 1: an already-consumed index and a skip-ahead index both conflict.
        assertThrows(ChunkIndexConflictException.class,
                () -> service.getNextChunkBytes(sessionID, 0));
        assertThrows(ChunkIndexConflictException.class,
                () -> service.getNextChunkBytes(sessionID, 5));
    }

    @Test
    void unknownSessionThrowsSessionNotFound() {
        assertThrows(SessionNotFoundException.class,
                () -> service.getNextChunkBytes("does-not-exist", 0));
    }
}
