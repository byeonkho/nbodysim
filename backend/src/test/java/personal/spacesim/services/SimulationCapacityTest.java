package personal.spacesim.services;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.Simulation;
import personal.spacesim.simulation.SimulationFactory;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;

import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SimulationCapacityTest {
    private final SimulationFactory factory = mock(SimulationFactory.class);
    private final Simulation simulation = mock(Simulation.class);
    private final AtomicLong clock = new AtomicLong();
    private final SimulationSessionService service = new SimulationSessionService(
            factory, mock(BinaryResponseSerializer.class), mock(ZstdCompressor.class), clock::get, 3, 2);

    @AfterEach
    void shutdown() { service.shutdown(); }

    private String create() {
        return service.createSimulation(List.of("Sun"), "ICRF", "EULER",
                AbsoluteDate.J2000_EPOCH, "hours", 1, 5000);
    }

    @Test
    void pendingInitializationsCountAgainstAdmissionLimit() throws Exception {
        CountDownLatch allAttempted = new CountDownLatch(6);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger admitted = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        when(factory.createSimulation(anyString(), anyList(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt())).thenAnswer(call -> {
            admitted.incrementAndGet();
            allAttempted.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return simulation;
        });
        List<Future<?>> results = new ArrayList<>();
        try (var requests = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                for (int i = 0; i < 6; i++) results.add(requests.submit(() -> {
                    try { create(); }
                    catch (SessionCapacityExceededException e) {
                        rejected.incrementAndGet();
                        allAttempted.countDown();
                    }
                }));
                assertTrue(allAttempted.await(5, TimeUnit.SECONDS));
                assertEquals(3, admitted.get());
                assertEquals(3, rejected.get());
            } finally { release.countDown(); }
            for (Future<?> result : results) result.get(5, TimeUnit.SECONDS);
        }
        assertEquals(3, service.getAllSimulations().size());
    }

    @Test
    void firstChunksShareTheGlobalComputeLimit() throws Exception {
        int limit = 2;
        int requestsCount = limit + 1;
        CountDownLatch allAttempted = new CountDownLatch(requestsCount);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger rejected = new AtomicInteger();
        when(factory.createSimulation(anyString(), anyList(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt())).thenReturn(simulation);
        when(simulation.run()).thenAnswer(call -> {
            active.incrementAndGet();
            allAttempted.countDown();
            try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
            finally { active.decrementAndGet(); }
            throw new IllegalStateException("stop after the observed computation");
        });
        List<Future<?>> results = new ArrayList<>();
        try (var requests = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                for (int i = 0; i < requestsCount; i++) {
                    String id = create();
                    results.add(requests.submit(() -> {
                        try { service.getNextChunkBytes(id, 0); }
                        catch (SessionCapacityExceededException e) {
                            assertNotNull(service.getSimulation(id), "overload must preserve unadvanced session");
                            rejected.incrementAndGet();
                            allAttempted.countDown();
                        } catch (IllegalStateException expected) { /* released test computation */ }
                    }));
                }
                assertTrue(allAttempted.await(5, TimeUnit.SECONDS));
                assertEquals(Math.min(limit, requestsCount), active.get());
                assertEquals(Math.max(0, requestsCount - limit), rejected.get());
            } finally { release.countDown(); }
            for (Future<?> result : results) result.get(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void failedInitializationAndRepeatedRemovalReleaseExactlyOneSlot() {
        when(factory.createSimulation(anyString(), anyList(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt()))
                .thenThrow(new IllegalStateException("initialization failed"))
                .thenReturn(simulation);
        assertThrows(IllegalStateException.class, this::create);
        String first = create();
        create();
        create();
        assertThrows(SessionCapacityExceededException.class, this::create);
        service.removeSimulation(first);
        service.removeSimulation(first);
        create();
        assertThrows(SessionCapacityExceededException.class, this::create);
        assertEquals(3, service.getAllSimulations().size());
    }

    @Test
    void idleEvictionReleasesEachSlotOnlyOnce() {
        when(factory.createSimulation(anyString(), anyList(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt())).thenReturn(simulation);
        String old = create();
        create();
        create();
        clock.set(16 * 60 * 1000L);
        service.evictIdleSimulations();
        service.removeSimulation(old);
        create();
        create();
        create();
        assertThrows(SessionCapacityExceededException.class, this::create);
    }
    @Test
    void cancelledBackgroundWorkHoldsCapacityUntilItActuallyEnds() throws Exception {
        BinaryResponseSerializer serializer = mock(BinaryResponseSerializer.class);
        ZstdCompressor compressor = mock(ZstdCompressor.class);
        SimulationSessionService mixed = new SimulationSessionService(
                factory, serializer, compressor, clock::get, 3, 2);
        CountDownLatch backgroundStarted = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch backgroundEnded = new CountDownLatch(2);
        when(factory.createSimulation(anyString(), anyList(), anyString(), anyString(),
                any(), anyString(), anyInt(), anyInt())).thenReturn(simulation);
        when(simulation.getCelestialBodies()).thenReturn(List.of());
        when(serializer.serialize(any(), any())).thenReturn(new byte[]{1});
        when(compressor.compress(any(byte[].class))).thenReturn(new byte[]{2});
        when(simulation.run()).thenAnswer(call -> {
            if (Thread.currentThread().getName().equals("spacesim-precompute")) {
                backgroundStarted.countDown();
                try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
                finally { backgroundEnded.countDown(); }
            }
            return mock(personal.spacesim.simulation.ChunkResult.class);
        });
        try {
            List<String> ids = new ArrayList<>();
            for (int i = 0; i < 3; i++) ids.add(mixed.createSimulation(List.of("Sun"),
                    "ICRF", "EULER", AbsoluteDate.J2000_EPOCH, "hours", 1, 5000));
            mixed.getNextChunkBytes(ids.get(0), 0);
            mixed.getNextChunkBytes(ids.get(1), 0);
            assertTrue(backgroundStarted.await(5, TimeUnit.SECONDS));
            var secondFuture = mixed.peekPrecomputedChunk(ids.get(1));
            mixed.removeSimulation(ids.get(0));
            assertThrows(SessionCapacityExceededException.class,
                    () -> mixed.getNextChunkBytes(ids.get(2), 0));
            assertNotNull(mixed.getSimulation(ids.get(2)));
            release.countDown();
            assertTrue(backgroundEnded.await(5, TimeUnit.SECONDS));
            secondFuture.get(5, TimeUnit.SECONDS);
            assertArrayEquals(new byte[]{2}, mixed.getNextChunkBytes(ids.get(2), 0));
        } finally {
            release.countDown();
            mixed.shutdown();
        }
    }

}
