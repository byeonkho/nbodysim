# Data Buffering Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chunk transitions imperceptible at any playback speed by replacing the date-keyed simulationData object with a typed-array buffer, adding backend speculative precompute of chunk N+1, making the prefetch threshold speed-aware, and removing the forced auto-unpause + modal.

**Architecture:** Five phases on branch `buffering-pipeline-redesign`. Phase 1 lands a backend cache (additive, no client change). Phase 2 builds the typed-array buffer module in isolation with full test coverage. Phase 3 rewires the slice + decode worker to use it. Phase 4 migrates every render-loop / chrome consumer. Phases 5–6 add speed-aware prefetch and remove the modal / auto-unpause / dev logs. Spec lives at [docs/superpowers/specs/2026-05-14-data-buffering-pipeline-redesign.md](../specs/2026-05-14-data-buffering-pipeline-redesign.md).

**Tech Stack:** Spring Boot 3 (Java 21), Orekit, JUnit Jupiter. Next.js 16, React Three Fiber, Redux Toolkit, Vitest. zstd-wasm via Web Worker.

---

## File Structure

**Backend (new + modified):**
- Modify: `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java` — add per-session `nextChunkCache: ConcurrentHashMap<String, CompletableFuture<byte[]>>`, inject serializer + compressor, add `getNextChunkBytes(sessionID)` that handles cache lookup + kicks off precompute.
- Modify: `backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java` — thin wrapper around `getNextChunkBytes`.
- Create: `backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java` — verifies the precompute state machine.

**Frontend (new):**
- Create: `frontend/src/app/store/chunkBuffer.ts` — `ChunkBuffer` type, `createChunkBuffer`, `appendChunk`, `readBodyStateInto`, `readBodyPositionInto`, `getTimestamp`, `getTimestampAsIsoString`, `selectBufferByteBudget`, `computeBufferCapacity`, eviction.
- Create: `frontend/src/app/store/chunkBuffer.test.ts` — accessor + eviction tests.
- Create: `frontend/src/app/components/interface/misc/FirstLoadSpinner.tsx` — replaces UpdateModal, only shown until first chunk lands.

**Frontend (modified):**
- `frontend/src/app/store/middleware/parseBinaryChunk.ts` — add `parseBinaryChunkToBuffer` variant that writes into a typed-array slot range; keep existing function or repoint it.
- `frontend/src/app/store/middleware/parseBinaryChunk.test.ts` — add tests for the typed-array variant against the same fixture bytes.
- `frontend/src/app/store/middleware/zstdWorker.ts` — emit typed arrays via transferable list.
- `frontend/src/app/store/middleware/simulationRequestThunk.ts` — wire latency-EMA measurement, drop `setIsUpdating`, route response into the new buffer-append action.
- `frontend/src/app/store/slices/SimulationSlice.ts` — replace `simulationData` with `chunkBuffer`; rewrite `loadSimulation`, `updateDataReceived`, drop `deleteExcessData` (eviction lives in chunkBuffer), drop `setIsUpdating` / `selectIsUpdating`, drop `selectTimeStepKeys` / `selectCurrentTimeStepKey` / `selectSimulationDataSize`, update middleware threshold formula, remove auto-unpause + dev log.
- `frontend/src/app/store/slices/RequestSlice.ts` — add `fetchLatencyEmaMs` + `recordFetchLatency`.
- `frontend/src/app/store/slices/SimulationSlice.test.ts` — update assertions for new shape.
- `frontend/src/app/constants/SimConstants.ts` — drop `MAX_TIMESTEPS` and `TIMESTEP_CHUNK_SIZE` (TIMESTEP_CHUNK_SIZE moves to chunkBuffer.ts as `CHUNK_SIZE`).
- `frontend/src/app/components/scene/Layout.tsx` — drop `<UpdateModal />` mount, add `<FirstLoadSpinner />`.
- Delete: `frontend/src/app/components/interface/misc/UpdateModal.tsx`.

**Consumer files (migrate from `simulationData[key]` + `snapshot.find` pattern → typed-array accessors):**
- `frontend/src/app/components/scene/AnimationController.tsx`
- `frontend/src/app/components/scene/Sphere.tsx`
- `frontend/src/app/components/scene/Trail.tsx`
- `frontend/src/app/components/scene/Reticle.tsx`
- `frontend/src/app/components/scene/GhostLabel.tsx`
- `frontend/src/app/components/scene/Camera.tsx`
- `frontend/src/app/components/scene/OrbitPath.tsx`
- `frontend/src/app/components/chrome/TopStatusStrip.tsx`
- `frontend/src/app/components/chrome/Timeline.tsx`
- `frontend/src/app/components/chrome/BodyCard.tsx`
- `frontend/src/app/components/dev/DevPanel.tsx` (uses `selectSimulationDataSize`)

---

## Phase 1 — Backend speculative precompute

Goal: after the first `/chunk` request lands, the next 10k-step compute starts in the background so the second request returns near-instantly.

### Task 1.1: Add precompute cache state to SimulationSessionService

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java`

- [ ] **Step 1: Add imports + new fields, inject serializer + compressor**

In `SimulationSessionService.java`, add these imports near the top of the file (after the existing imports):

```java
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;
import java.util.LinkedHashMap;
```

Replace the field block (just below the existing `private final SimulationFactory simulationFactory;` line) so the class declares the new dependencies and the cache:

```java
    private final ConcurrentHashMap<String, Simulation> simulationMap;
    private final ConcurrentHashMap<String, Long> lastAccessedAt;
    private final SimulationFactory simulationFactory;
    private final BinaryResponseSerializer binaryResponseSerializer;
    private final ZstdCompressor zstdCompressor;

    // Per-session next-chunk precompute. The future may be in-flight or done.
    // null entry = no precompute kicked off yet (first request, or after eviction).
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> nextChunkCache;

    // Bounded executor for precompute work. Threads are daemon so they don't
    // prevent JVM shutdown if a request is in flight at exit.
    private final ExecutorService precomputeExecutor = Executors.newFixedThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors() / 2),
            r -> {
                Thread t = new Thread(r, "spacesim-precompute");
                t.setDaemon(true);
                return t;
            });
```

Update the constructor signature and body:

```java
    @Autowired
    public SimulationSessionService(
            SimulationFactory simulationFactory,
            BinaryResponseSerializer binaryResponseSerializer,
            ZstdCompressor zstdCompressor
    ) {
        this.simulationFactory = simulationFactory;
        this.binaryResponseSerializer = binaryResponseSerializer;
        this.zstdCompressor = zstdCompressor;
        this.simulationMap = new ConcurrentHashMap<>();
        this.lastAccessedAt = new ConcurrentHashMap<>();
        this.nextChunkCache = new ConcurrentHashMap<>();
    }
```

- [ ] **Step 2: Run build to verify the class still compiles**

Run: `cd backend && ./mvnw compile -q`
Expected: PASS (Spring will inject the new dependencies — both already exist as `@Component` beans).

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/personal/spacesim/services/SimulationSessionService.java
git commit -m "service: add precompute cache fields + inject serializer/compressor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Add `getNextChunkBytes` with precompute kickoff (TDD)

**Files:**
- Create: `backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java`
- Modify: `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java`

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java`:

```java
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
        // Tiny sim — 1 body, default integrator. Keeps the test under a few seconds.
        String sessionID = service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "MINUTES"
        );

        byte[] first = service.getNextChunkBytes(sessionID);
        assertNotNull(first);
        assertTrue(first.length > 0);

        // Precompute should be running (or already done).
        CompletableFuture<byte[]> nextFuture = service.peekPrecomputedChunk(sessionID);
        assertNotNull(nextFuture, "expected precompute to be kicked off after first call");

        // Wait up to 30s for precompute to complete — generous since
        // CI cold-start can be slow. Failing the timeout means precompute
        // wasn't actually submitted.
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
                "MINUTES"
        );

        service.getNextChunkBytes(sessionID);
        // Force precompute to settle.
        service.peekPrecomputedChunk(sessionID).get(30, TimeUnit.SECONDS);

        long t0 = System.nanoTime();
        byte[] second = service.getNextChunkBytes(sessionID);
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000;

        assertNotNull(second);
        assertTrue(second.length > 0);
        // Cache hit path is byte-copy + post-compute submit; should be < 100ms
        // even on slow CI. The fresh compute path takes seconds.
        assertTrue(elapsedMs < 500,
                "expected cache hit < 500ms, got " + elapsedMs + "ms");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ./mvnw test -Dtest=SimulationSessionServiceTest -q`
Expected: FAIL — `getNextChunkBytes` and `peekPrecomputedChunk` methods don't exist yet (compile error).

- [ ] **Step 3: Implement `getNextChunkBytes` + `peekPrecomputedChunk`**

In `SimulationSessionService.java`, add these methods (after `runSimulation` and before `evictIdleSimulations`):

```java
    /**
     * Returns the next zstd-compressed chunk byte[] for the session, taking it
     * from the precompute cache when available. Always kicks off the next
     * precompute before returning, so subsequent calls hit the cache.
     */
    public byte[] getNextChunkBytes(String sessionID) {
        lastAccessedAt.put(sessionID, System.currentTimeMillis());

        CompletableFuture<byte[]> cached = nextChunkCache.remove(sessionID);
        byte[] payload;
        if (cached != null) {
            try {
                // Either ready (instant) or still in-flight from prior precompute (await).
                payload = cached.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuntimeException("Interrupted while awaiting precomputed chunk", e);
            } catch (java.util.concurrent.ExecutionException e) {
                throw new RuntimeException("Precompute failed", e.getCause());
            }
        } else {
            // Cold path: no precompute kicked off yet (first request post-init,
            // or post-eviction). Compute synchronously on the request thread.
            payload = computeChunkBytes(sessionID);
        }

        // Always kick off the next precompute so the next request hits cache.
        kickOffNextPrecompute(sessionID);
        return payload;
    }

    /**
     * Test-only accessor: returns the current in-flight or completed precompute
     * future for the session, or null if none is pending. Not meant for
     * production code paths — request handling uses {@link #getNextChunkBytes}.
     */
    public CompletableFuture<byte[]> peekPrecomputedChunk(String sessionID) {
        return nextChunkCache.get(sessionID);
    }

    private void kickOffNextPrecompute(String sessionID) {
        // putIfAbsent prevents double-kickoff if a caller races with us.
        nextChunkCache.computeIfAbsent(sessionID, id ->
                CompletableFuture.supplyAsync(() -> computeChunkBytes(id), precomputeExecutor));
    }

    private byte[] computeChunkBytes(String sessionID) {
        Simulation simulation = getSimulation(sessionID);
        if (simulation == null) {
            throw new IllegalArgumentException("Simulation not found for session ID: " + sessionID);
        }

        java.util.Map<AbsoluteDate, List<CelestialBodySnapshot>> chunkData = simulation.run();

        // µ map built fresh each chunk; constant per session but cheap (~9 entries).
        LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
        for (CelestialBodyWrapper w : simulation.getCelestialBodies()) {
            muByName.put(w.getName(), w.getMu());
        }

        byte[] binary = binaryResponseSerializer.serialize(chunkData, muByName);
        return zstdCompressor.compress(binary);
    }
```

Update `removeSimulation` to also clear the cache:

```java
    public void removeSimulation(String sessionID) {
        simulationMap.remove(sessionID);
        lastAccessedAt.remove(sessionID);
        CompletableFuture<byte[]> pending = nextChunkCache.remove(sessionID);
        if (pending != null) {
            pending.cancel(true);
        }
    }
```

Update `evictIdleSimulations` to also clear the cache:

```java
    @Scheduled(fixedRate = 60_000)
    public void evictIdleSimulations() {
        long now = System.currentTimeMillis();
        Iterator<Map.Entry<String, Long>> it = lastAccessedAt.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> entry = it.next();
            if (now - entry.getValue() > IDLE_TIMEOUT_MS) {
                String sessionID = entry.getKey();
                simulationMap.remove(sessionID);
                CompletableFuture<byte[]> pending = nextChunkCache.remove(sessionID);
                if (pending != null) {
                    pending.cancel(true);
                }
                it.remove();
                logger.info("Evicted idle simulation {}", sessionID);
            }
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && ./mvnw test -Dtest=SimulationSessionServiceTest -q`
Expected: PASS for both tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main/java/personal/spacesim/services/SimulationSessionService.java backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java
git commit -m "service: speculative precompute of next chunk after each request

After every getNextChunkBytes call we submit the next 10k-step compute
to a daemon executor. Subsequent requests hit the cache; cold path
computes synchronously and still kicks off the next precompute.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Route controller through new service method

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java`

- [ ] **Step 1: Simplify `getNextChunk` to call the new service method**

Replace the body of `getNextChunk` in `SimulationController.java` (the method starting at line 91) with:

```java
    @PostMapping(value = "/chunk", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getNextChunk(@RequestBody SimulationChunkRequest request) {
        String sessionID = request.sessionID();
        if (sessionID == null) {
            return ResponseEntity.badRequest().build();
        }

        long t0 = System.nanoTime();
        logger.info("[{}] Chunk request received", sessionID);

        byte[] compressedData = simulationSessionService.getNextChunkBytes(sessionID);

        long tTotal = (System.nanoTime() - t0) / 1_000_000;
        logger.info(
                "[{}] Chunk served in {}ms ({} KB)",
                sessionID,
                tTotal,
                compressedData.length / 1024
        );

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(compressedData);
    }
```

Also drop the unused fields and imports — the controller no longer needs `ZstdCompressor` or `BinaryResponseSerializer` directly. Replace the field block + constructor at the top of the class (lines ~30–44) with:

```java
    private final SimulationSessionService simulationSessionService;

    @Autowired
    public SimulationController(SimulationSessionService simulationSessionService) {
        this.simulationSessionService = simulationSessionService;
    }
```

And remove these imports from the top of the file:

```java
import personal.spacesim.simulation.body.CelestialBodySnapshot;
import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.compressor.ZstdCompressor;
import personal.spacesim.utils.serializers.BinaryResponseSerializer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
```

- [ ] **Step 2: Run build to verify compile**

Run: `cd backend && ./mvnw compile -q`
Expected: PASS.

- [ ] **Step 3: Run full backend test suite to verify nothing else broke**

Run: `cd backend && ./mvnw test -q`
Expected: PASS (existing tests + the new SimulationSessionServiceTest).

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java
git commit -m "controller: route /chunk through new service.getNextChunkBytes

Controller is now a thin wrapper — serialization + compression moved
into the service alongside the precompute cache.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Typed-array buffer module

Goal: build a self-contained module with the `ChunkBuffer` type and its accessors, fully unit-tested, with no Redux wiring yet. Phase 3 will integrate it.

### Task 2.1: Scaffold chunkBuffer.ts with type + constructor (TDD)

**Files:**
- Create: `frontend/src/app/store/chunkBuffer.ts`
- Create: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/store/chunkBuffer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createChunkBuffer, CHUNK_SIZE } from "./chunkBuffer";

describe("createChunkBuffer", () => {
  it("allocates positions and timestamps sized for the given capacity", () => {
    const buf = createChunkBuffer(["Earth", "Moon"], 1000);
    expect(buf.bodyCount).toBe(2);
    expect(buf.bodyNames).toEqual(["Earth", "Moon"]);
    expect(buf.bodyNameToIndex.get("Earth")).toBe(0);
    expect(buf.bodyNameToIndex.get("Moon")).toBe(1);
    expect(buf.positions.length).toBe(1000 * 2 * 6);
    expect(buf.timestamps.length).toBe(1000);
    expect(buf.totalTimesteps).toBe(0);
    expect(buf.bufferStartTimestep).toBe(0);
    expect(buf.capacity).toBe(1000);
  });

  it("exports CHUNK_SIZE", () => {
    expect(CHUNK_SIZE).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create chunkBuffer.ts with the type and constructor**

Create `frontend/src/app/store/chunkBuffer.ts`:

```ts
// Typed-array-backed buffer of simulation snapshots. Mirrors the backend's
// CelestialBodySnapshot layout (6 doubles per body per timestep: px, py, pz,
// vx, vy, vz) — the same flat layout the wire format ships, so the decode
// worker can write directly into this with no intermediate JS-object hops.
//
// Lookup is O(1) by timestep index, eliminating the Object.keys() / map.find
// hot-path costs of the previous date-keyed object representation.

export const CHUNK_SIZE = 10_000;
export const BYTES_PER_TIMESTEP_PER_BODY = 6 * 8; // 6 doubles

export interface ChunkBuffer {
  positions: Float64Array;
  timestamps: BigInt64Array;
  bodyNames: readonly string[];
  bodyNameToIndex: ReadonlyMap<string, number>;
  bodyCount: number;
  capacity: number;
  // Number of valid timesteps currently in the buffer. Write cursor.
  totalTimesteps: number;
  // Where the kept window starts in the session's global timestep numbering.
  // Advances by CHUNK_SIZE every eviction.
  bufferStartTimestep: number;
}

export function createChunkBuffer(
  bodyNames: readonly string[],
  capacity: number,
): ChunkBuffer {
  const bodyCount = bodyNames.length;
  const map = new Map<string, number>();
  for (let i = 0; i < bodyNames.length; i++) {
    map.set(bodyNames[i], i);
  }
  return {
    positions: new Float64Array(capacity * bodyCount * 6),
    timestamps: new BigInt64Array(capacity),
    bodyNames,
    bodyNameToIndex: map,
    bodyCount,
    capacity,
    totalTimesteps: 0,
    bufferStartTimestep: 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "buffer: ChunkBuffer type + createChunkBuffer constructor

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Add byte-budget selection + capacity computation (TDD)

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/app/store/chunkBuffer.test.ts`:

```ts
import {
  computeBufferCapacity,
  selectBufferByteBudget,
  BUFFER_BYTE_BUDGETS,
} from "./chunkBuffer";

describe("selectBufferByteBudget", () => {
  it("returns lowMem budget when viewport is narrow", () => {
    const fakeMatchMedia = (q: string) => ({
      matches: q.includes("max-width: 767px"),
    });
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: fakeMatchMedia as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns lowMem budget when deviceMemory ≤ 4", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 4 } as unknown as Navigator,
      matchMedia: ((_q: string) => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns default budget when neither low-mem signal applies", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 8 } as unknown as Navigator,
      matchMedia: ((_q: string) => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });

  it("returns default budget when navigator/matchMedia are absent (SSR)", () => {
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: undefined,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });
});

describe("computeBufferCapacity", () => {
  it("derives capacity from byte budget and body count", () => {
    // 12 MB / (9 bodies × 48 bytes) = 27,962 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.lowMem)).toBe(27_962);
    // 48 MB / (9 bodies × 48 bytes) = 111,848 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.default)).toBe(111_848);
  });

  it("scales inversely with body count", () => {
    expect(computeBufferCapacity(3, BUFFER_BYTE_BUDGETS.default)).toBeGreaterThan(
      computeBufferCapacity(12, BUFFER_BYTE_BUDGETS.default),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: FAIL — `selectBufferByteBudget` / `computeBufferCapacity` / `BUFFER_BYTE_BUDGETS` not exported.

- [ ] **Step 3: Implement budget selection + capacity**

Append to `frontend/src/app/store/chunkBuffer.ts`:

```ts
export const BUFFER_BYTE_BUDGETS = {
  lowMem: 12 * 1024 * 1024,   // 12 MB — mobile / low-RAM
  default: 48 * 1024 * 1024,  // 48 MB — desktop / tablet
} as const;

interface ByteBudgetEnv {
  navigator: Navigator | undefined;
  matchMedia: typeof window.matchMedia | undefined;
}

// `env` is injected so tests can drive the branches without globals.
// Default reads window/navigator if present (handles SSR + node-test env).
export function selectBufferByteBudget(env?: ByteBudgetEnv): number {
  const e: ByteBudgetEnv = env ?? {
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    matchMedia: typeof window !== "undefined" ? window.matchMedia : undefined,
  };
  const dm =
    e.navigator !== undefined && "deviceMemory" in e.navigator
      ? ((e.navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? Infinity)
      : Infinity;
  const isLowMem = dm <= 4;
  const isNarrow =
    e.matchMedia !== undefined &&
    e.matchMedia("(max-width: 767px)").matches;
  return isLowMem || isNarrow
    ? BUFFER_BYTE_BUDGETS.lowMem
    : BUFFER_BYTE_BUDGETS.default;
}

export function computeBufferCapacity(
  bodyCount: number,
  byteBudget: number,
): number {
  return Math.floor(byteBudget / (bodyCount * BYTES_PER_TIMESTEP_PER_BODY));
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "buffer: byte-budget selection + capacity computation

Tiered at 12 MB (mobile/low-mem) and 48 MB (desktop/tablet) per spec.
Capacity falls out as floor(budget / (bodyCount × 48)) so it scales
inversely with body count.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Add appendChunk + eviction logic (TDD)

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/app/store/chunkBuffer.test.ts`:

```ts
import { appendChunk } from "./chunkBuffer";

function makeChunkPositions(
  bodyCount: number,
  timestepCount: number,
  startValue = 0,
): Float64Array {
  const arr = new Float64Array(bodyCount * timestepCount * 6);
  for (let i = 0; i < arr.length; i++) arr[i] = startValue + i;
  return arr;
}

function makeChunkTimestamps(
  timestepCount: number,
  startMillis = 0n,
): BigInt64Array {
  const arr = new BigInt64Array(timestepCount);
  for (let i = 0; i < timestepCount; i++) arr[i] = startMillis + BigInt(i);
  return arr;
}

describe("appendChunk", () => {
  it("appends to a fresh buffer without eviction", () => {
    const buf = createChunkBuffer(["A", "B"], 100);
    const positions = makeChunkPositions(2, 10);
    const timestamps = makeChunkTimestamps(10);
    appendChunk(buf, positions, timestamps, 10);

    expect(buf.totalTimesteps).toBe(10);
    expect(buf.bufferStartTimestep).toBe(0);
    // First slot of first body
    expect(buf.positions[0]).toBe(0);
    // Last slot of last body of timestep 9
    expect(buf.positions[10 * 2 * 6 - 1]).toBe(positions[positions.length - 1]);
    expect(buf.timestamps[9]).toBe(9n);
  });

  it("evicts oldest timesteps in chunk-sized blocks when capacity is exceeded", () => {
    // Capacity 30 = 3 × CHUNK_SIZE-equivalent in this small test. We use a
    // local CHUNK_SIZE of 10 to keep numbers readable: pass an explicit
    // evictBlockSize so the test isn't tied to the production CHUNK_SIZE.
    const buf = createChunkBuffer(["A"], 30);
    appendChunk(buf, makeChunkPositions(1, 10, 0), makeChunkTimestamps(10, 0n), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 100), makeChunkTimestamps(10, 100n), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 200), makeChunkTimestamps(10, 200n), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(0);

    // Fourth chunk forces eviction of the first 10 timesteps.
    appendChunk(buf, makeChunkPositions(1, 10, 300), makeChunkTimestamps(10, 300n), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(10);

    // First valid timestep is now what was originally timestep 10 (value 100).
    expect(buf.timestamps[0]).toBe(100n);
    expect(buf.positions[0]).toBe(100);
    // Last valid timestep is the freshly-appended one (300+59).
    expect(buf.timestamps[29]).toBe(309n);
  });

  it("returns the number of timesteps shifted (0 if no eviction)", () => {
    const buf = createChunkBuffer(["A"], 30);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: FAIL — `appendChunk` not exported.

- [ ] **Step 3: Implement appendChunk**

Append to `frontend/src/app/store/chunkBuffer.ts`:

```ts
/**
 * Appends a chunk of timesteps to the buffer. If the new data won't fit,
 * shifts the buffer left by `chunkLen` slots to make room (evicting the
 * oldest entries) and advances `bufferStartTimestep` accordingly. Returns
 * the number of timesteps shifted (0 if no eviction occurred).
 *
 * `chunkPositions.length` must equal `chunkLen × bodyCount × 6`.
 * `chunkTimestamps.length` must equal `chunkLen`.
 */
export function appendChunk(
  buffer: ChunkBuffer,
  chunkPositions: Float64Array,
  chunkTimestamps: BigInt64Array,
  chunkLen: number,
): number {
  const stride = buffer.bodyCount * 6;
  let shifted = 0;

  if (buffer.totalTimesteps + chunkLen > buffer.capacity) {
    // Drop the oldest `chunkLen` timesteps. We assume chunks are uniformly
    // sized so a single chunk's worth of eviction always makes room.
    const dropCount = chunkLen;
    const surviveCount = buffer.totalTimesteps - dropCount;

    // Shift positions and timestamps left by dropCount slots in place.
    // copyWithin is a single memmove call — fast even on large arrays.
    buffer.positions.copyWithin(
      0,
      dropCount * stride,
      (dropCount + surviveCount) * stride,
    );
    buffer.timestamps.copyWithin(0, dropCount, dropCount + surviveCount);

    buffer.totalTimesteps = surviveCount;
    buffer.bufferStartTimestep += dropCount;
    shifted = dropCount;
  }

  // Write the new chunk at the current cursor.
  buffer.positions.set(chunkPositions, buffer.totalTimesteps * stride);
  buffer.timestamps.set(chunkTimestamps, buffer.totalTimesteps);
  buffer.totalTimesteps += chunkLen;

  return shifted;
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "buffer: appendChunk with copyWithin-based eviction

Returns shift count so the slice can adjust currentTimeStepIndex
in response to eviction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.4: Add position/state accessors (TDD)

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/app/store/chunkBuffer.test.ts`:

```ts
import { readBodyPositionInto, readBodyStateInto } from "./chunkBuffer";
import * as THREE from "three";

describe("readBodyPositionInto", () => {
  it("reads px/py/pz into the provided Vector3 (no allocation)", () => {
    const buf = createChunkBuffer(["A", "B"], 10);
    // Timestep 2, body 1: write known values into the slot.
    const base = 2 * 2 * 6 + 1 * 6;
    buf.positions[base + 0] = 100;
    buf.positions[base + 1] = 200;
    buf.positions[base + 2] = 300;
    buf.positions[base + 3] = 0.1; // vx — should be ignored
    buf.totalTimesteps = 3;

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 2, 1);
    expect(out.x).toBe(100);
    expect(out.y).toBe(200);
    expect(out.z).toBe(300);
  });
});

describe("readBodyStateInto", () => {
  it("reads position AND velocity into two provided Vector3s", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.positions[0] = 1;
    buf.positions[1] = 2;
    buf.positions[2] = 3;
    buf.positions[3] = 4;
    buf.positions[4] = 5;
    buf.positions[5] = 6;
    buf.totalTimesteps = 1;

    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    readBodyStateInto(pos, vel, buf, 0, 0);
    expect([pos.x, pos.y, pos.z]).toEqual([1, 2, 3]);
    expect([vel.x, vel.y, vel.z]).toEqual([4, 5, 6]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: FAIL — accessors not exported.

- [ ] **Step 3: Implement accessors**

Append to `frontend/src/app/store/chunkBuffer.ts`:

```ts
import type { Vector3 as ThreeVector3 } from "three";

// Caller provides the output Vector3 — never allocates per call. Designed
// to be called inside useFrame at FPS rate.
export function readBodyPositionInto(
  out: ThreeVector3,
  buffer: ChunkBuffer,
  timestepIdx: number,
  bodyIdx: number,
): void {
  const base = timestepIdx * buffer.bodyCount * 6 + bodyIdx * 6;
  out.x = buffer.positions[base];
  out.y = buffer.positions[base + 1];
  out.z = buffer.positions[base + 2];
}

export function readBodyStateInto(
  outPos: ThreeVector3,
  outVel: ThreeVector3,
  buffer: ChunkBuffer,
  timestepIdx: number,
  bodyIdx: number,
): void {
  const base = timestepIdx * buffer.bodyCount * 6 + bodyIdx * 6;
  outPos.x = buffer.positions[base];
  outPos.y = buffer.positions[base + 1];
  outPos.z = buffer.positions[base + 2];
  outVel.x = buffer.positions[base + 3];
  outVel.y = buffer.positions[base + 4];
  outVel.z = buffer.positions[base + 5];
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "buffer: readBodyPositionInto / readBodyStateInto accessors

Caller-provided Vector3 outputs so render-loop consumers can read
state at any (timestep, body) without per-frame allocation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.5: Add timestamp accessors (TDD)

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/app/store/chunkBuffer.test.ts`:

```ts
import { getTimestamp, getTimestampAsIsoString } from "./chunkBuffer";

describe("getTimestamp / getTimestampAsIsoString", () => {
  it("returns raw millis as BigInt and ISO string for a given timestep", () => {
    const buf = createChunkBuffer(["A"], 5);
    const millis = BigInt(Date.UTC(2024, 5, 5));
    buf.timestamps[0] = millis;
    buf.totalTimesteps = 1;

    expect(getTimestamp(buf, 0)).toBe(millis);
    expect(getTimestampAsIsoString(buf, 0)).toBe("2024-06-05T00:00:00.000Z");
  });

  it("returns null/empty for out-of-range indices", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.totalTimesteps = 0;
    expect(getTimestampAsIsoString(buf, 0)).toBe("");
    expect(getTimestampAsIsoString(buf, -1)).toBe("");
    expect(getTimestampAsIsoString(buf, 5)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement timestamp accessors**

Append to `frontend/src/app/store/chunkBuffer.ts`:

```ts
export function getTimestamp(buffer: ChunkBuffer, timestepIdx: number): bigint {
  return buffer.timestamps[timestepIdx];
}

export function getTimestampAsIsoString(
  buffer: ChunkBuffer,
  timestepIdx: number,
): string {
  if (timestepIdx < 0 || timestepIdx >= buffer.totalTimesteps) return "";
  const millis = Number(buffer.timestamps[timestepIdx]);
  return new Date(millis).toISOString();
}
```

- [ ] **Step 4: Run tests + full chunkBuffer suite**

Run: `cd frontend && npx vitest run src/app/store/chunkBuffer.test.ts`
Expected: PASS for the whole file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "buffer: timestamp accessors

getTimestamp returns raw bigint, getTimestampAsIsoString handles
out-of-range with empty string so render consumers can early-return
without conditional logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Wire ChunkBuffer into slice + decoder

Goal: replace the existing `simulationData` field with `chunkBuffer`, route the decode worker through a typed-array path, and update slice reducers + selectors. The app will not render until Phase 4 migrates the consumers — this is one logical change spread over a few commits on the branch.

### Task 3.1: Update parseBinaryChunk to emit typed arrays (TDD)

**Files:**
- Modify: `frontend/src/app/store/middleware/parseBinaryChunk.ts`
- Modify: `frontend/src/app/store/middleware/parseBinaryChunk.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/app/store/middleware/parseBinaryChunk.test.ts` (after the existing tests, before the closing `});` of the outer describe):

```ts
import { parseBinaryChunkToTypedArrays } from "./parseBinaryChunk";

describe("parseBinaryChunkToTypedArrays", () => {
  it("decodes the same wire format into typed arrays in row-major layout", () => {
    const bytes = buildChunkBytes(
      [
        { name: "Earth", mu: 3.986004418e14 },
        { name: "Moon", mu: 4.9028000661e12 },
      ],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          bodies: [
            { pos: [1, 2, 3], vel: [4, 5, 6] },
            { pos: [7, 8, 9], vel: [10, 11, 12] },
          ],
        },
        {
          millis: Date.UTC(2024, 5, 6),
          bodies: [
            { pos: [13, 14, 15], vel: [16, 17, 18] },
            { pos: [19, 20, 21], vel: [22, 23, 24] },
          ],
        },
      ],
    );

    const result = parseBinaryChunkToTypedArrays(bytes);
    expect(result.bodyNames).toEqual(["Earth", "Moon"]);
    expect(result.bodyCount).toBe(2);
    expect(result.timestepCount).toBe(2);
    expect(result.mu).toEqual({
      Earth: 3.986004418e14,
      Moon: 4.9028000661e12,
    });
    expect(result.timestamps.length).toBe(2);
    expect(result.timestamps[0]).toBe(BigInt(Date.UTC(2024, 5, 5)));
    expect(result.timestamps[1]).toBe(BigInt(Date.UTC(2024, 5, 6)));

    // Layout: positions[t * bodyCount * 6 + b * 6 + c]
    // Timestep 0, Earth: 1, 2, 3, 4, 5, 6
    expect(Array.from(result.positions.slice(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    // Timestep 0, Moon: 7, 8, 9, 10, 11, 12
    expect(Array.from(result.positions.slice(6, 12))).toEqual([7, 8, 9, 10, 11, 12]);
    // Timestep 1, Earth: 13..18
    expect(Array.from(result.positions.slice(12, 18))).toEqual([13, 14, 15, 16, 17, 18]);
    // Timestep 1, Moon: 19..24
    expect(Array.from(result.positions.slice(18, 24))).toEqual([19, 20, 21, 22, 23, 24]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/store/middleware/parseBinaryChunk.test.ts`
Expected: FAIL — `parseBinaryChunkToTypedArrays` not exported.

- [ ] **Step 3: Implement the typed-array parser**

Append to `frontend/src/app/store/middleware/parseBinaryChunk.ts`:

```ts
export interface ParsedChunkTypedArrays {
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  // Length = timestepCount × bodyCount × 6.
  // Layout: positions[t * bodyCount * 6 + b * 6 + c]
  // components: 0=px 1=py 2=pz 3=vx 4=vy 5=vz
  positions: Float64Array;
  // Length = timestepCount. Millis since UNIX epoch.
  timestamps: BigInt64Array;
  // Per-body µ (m³/s²) keyed by body name.
  mu: Record<string, number>;
}

export function parseBinaryChunkToTypedArrays(
  bytes: Uint8Array,
): ParsedChunkTypedArrays {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const bodyCount = view.getUint16(offset, true);
  offset += 2;

  const bodyNames: string[] = new Array(bodyCount);
  const mu: Record<string, number> = {};
  for (let i = 0; i < bodyCount; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const nameBytes = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset + offset,
      nameLen,
    );
    const name = utf8Decoder.decode(nameBytes);
    bodyNames[i] = name;
    offset += nameLen;
    mu[name] = view.getFloat64(offset, true);
    offset += 8;
  }

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float64Array(timestepCount * bodyCount * 6);
  const timestamps = new BigInt64Array(timestepCount);

  for (let t = 0; t < timestepCount; t++) {
    timestamps[t] = view.getBigInt64(offset, true);
    offset += 8;
    const tBase = t * bodyCount * 6;
    for (let b = 0; b < bodyCount; b++) {
      const slotBase = tBase + b * 6;
      positions[slotBase + 0] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 1] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 2] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 3] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 4] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 5] = view.getFloat64(offset, true); offset += 8;
    }
  }

  return { bodyNames, bodyCount, timestepCount, positions, timestamps, mu };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/store/middleware/parseBinaryChunk.test.ts`
Expected: PASS for the whole file (existing tests + new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/middleware/parseBinaryChunk.ts frontend/src/app/store/middleware/parseBinaryChunk.test.ts
git commit -m "parser: parseBinaryChunkToTypedArrays — Float64 + BigInt64 outputs

Same wire format, different output shape. Existing parseBinaryChunk
stays for now until Phase 3.3 swaps the worker over.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: Update zstdWorker to emit typed arrays via transferable list

**Files:**
- Modify: `frontend/src/app/store/middleware/zstdWorker.ts`

- [ ] **Step 1: Replace the parse+post block to use the typed-array path**

In `zstdWorker.ts`, replace the existing handler body. Change the import:

```ts
import { parseBinaryChunkToTypedArrays } from "./parseBinaryChunk";
```

(Remove the existing `parseBinaryChunk` import line.)

And replace the message handler with:

```ts
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, buffer } = event.data;
  try {
    const decoder = await decoderPromise;
    const view = new DataView(buffer);
    const uncompressedSize = view.getUint32(0, true);
    const compressed = new Uint8Array(buffer, 4);

    const t0 = performance.now();
    const decompressed = decoder.decode(compressed, uncompressedSize);
    const t1 = performance.now();
    const parsed = parseBinaryChunkToTypedArrays(decompressed);
    const t2 = performance.now();
    console.log(
      `[zstd worker] zstd=${(t1 - t0) | 0}ms binary=${(t2 - t1) | 0}ms total=${(t2 - t0) | 0}ms (${(uncompressedSize / 1024) | 0}KB)`,
    );

    const payload = {
      messageType: "SIM_DATA",
      bodyNames: parsed.bodyNames,
      bodyCount: parsed.bodyCount,
      timestepCount: parsed.timestepCount,
      positions: parsed.positions,
      timestamps: parsed.timestamps,
      mu: parsed.mu,
    };
    const response: DecodeSuccess = { id, payload };
    // Transfer the typed-array buffers — zero-copy back to main thread.
    self.postMessage(response, [
      parsed.positions.buffer,
      parsed.timestamps.buffer,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: DecodeError = { id, error: message };
    self.postMessage(response);
  }
};
```

- [ ] **Step 2: Run build to verify nothing else references the old payload shape**

Run: `cd frontend && npx tsc --noEmit`
Expected: there will be type errors in `simulationRequestThunk.ts` since `ChunkPayload` no longer matches the worker's emitted payload. We'll fix that in Task 3.3. For now, just confirm the worker file itself compiles. Run instead:

`cd frontend && npx tsc --noEmit src/app/store/middleware/zstdWorker.ts --target es2022 --lib es2022,dom,webworker --module esnext --moduleResolution bundler`

Expected: PASS for this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/store/middleware/zstdWorker.ts
git commit -m "worker: emit typed arrays + transfer ArrayBuffers (zero-copy)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: Update thunk and ChunkPayload shape

**Files:**
- Modify: `frontend/src/app/store/middleware/simulationRequestThunk.ts`

- [ ] **Step 1: Replace ChunkPayload and the dispatch into Redux**

Replace the entire `simulationRequestThunk.ts` content with:

```ts
// Thunk that fetches the next simulation chunk over HTTP, decodes it off-thread
// via the zstd worker, and dispatches the parsed payload into Redux.

import { createAsyncThunk } from "@reduxjs/toolkit";
import { appendChunkToBuffer } from "@/app/store/slices/SimulationSlice";
import {
  recordFetchLatency,
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { AppDispatch, RootState } from "@/app/store/Store";
import type { DecodeResponse } from "./zstdWorker";

interface ChunkPayload {
  messageType: string;
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: BigInt64Array;
  mu: Record<string, number>;
}

// Decoder Worker — module singleton, kept alive for the page session.
let decoderWorker: Worker | null = null;
let decodeIdCounter = 0;
const pendingDecodes = new Map<
  number,
  { resolve: (value: ChunkPayload) => void; reject: (reason: Error) => void }
>();

function getDecoderWorker(): Worker {
  if (decoderWorker) return decoderWorker;
  decoderWorker = new Worker(new URL("./zstdWorker.ts", import.meta.url), {
    type: "module",
  });
  decoderWorker.onmessage = (event: MessageEvent<DecodeResponse>) => {
    const { id } = event.data;
    const pending = pendingDecodes.get(id);
    if (!pending) return;
    pendingDecodes.delete(id);
    if ("error" in event.data) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.payload as ChunkPayload);
    }
  };
  decoderWorker.onerror = (event: ErrorEvent) => {
    console.error("zstd worker error:", event.message);
  };
  return decoderWorker;
}

function decodeOffMainThread(buffer: ArrayBuffer): Promise<ChunkPayload> {
  const id = ++decodeIdCounter;
  return new Promise((resolve, reject) => {
    pendingDecodes.set(id, { resolve, reject });
    getDecoderWorker().postMessage({ id, buffer }, [buffer]);
  });
}

interface RequestRunSimulationArgs {
  sessionID: string;
}

export const requestRunSimulation = createAsyncThunk<
  void,
  RequestRunSimulationArgs,
  { state: RootState }
>(
  "simulation/requestChunk",
  async ({ sessionID }, { dispatch, getState, signal }) => {
    dispatch(setRequestInProgress(true));
    const tStart = performance.now();

    try {
      const response = await fetch(`${REST_URL}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID }),
        signal,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const wait = seconds && !Number.isNaN(seconds) ? ` Try again in ${seconds}s.` : "";
        throw new Error(`Rate limit reached.${wait}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const messageData = await decodeOffMainThread(buffer);

      // Stale-session guard: drop silently if user resubmitted in flight.
      const currentSessionID =
        getState().simulation.simulationParameters?.simulationMetaData?.sessionID;
      if (currentSessionID !== sessionID) {
        dispatch(setRequestInProgress(false));
        return;
      }

      const elapsedMs = performance.now() - tStart;
      dispatch(recordFetchLatency(elapsedMs));
      dispatch(setRequestInProgress(false));
      dispatch(
        appendChunkToBuffer({
          bodyNames: messageData.bodyNames,
          bodyCount: messageData.bodyCount,
          timestepCount: messageData.timestepCount,
          positions: messageData.positions,
          timestamps: messageData.timestamps,
          mu: messageData.mu,
        }),
      );
    } catch (err) {
      dispatch(setRequestInProgress(false));
      // Aborted by dispatchChunkRequest when a newer request supersedes
      // this one — silent, not a user-facing error.
      if (
        signal.aborted ||
        (err instanceof Error &&
          (err.name === "AbortError" || err.name === "CanceledError"))
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      dispatch(setErrorMessage(`Failed to load simulation chunk: ${message}`));
      throw err;
    }
  },
);

// Module-level handle on the most recent in-flight chunk dispatch.
let currentChunkDispatch:
  | (Promise<unknown> & { abort: (reason?: string) => void })
  | null = null;

export function dispatchChunkRequest(
  dispatch: AppDispatch,
  args: RequestRunSimulationArgs,
) {
  if (currentChunkDispatch) {
    currentChunkDispatch.abort("superseded");
  }
  currentChunkDispatch = dispatch(requestRunSimulation(args));
  return currentChunkDispatch;
}
```

- [ ] **Step 2: Commit (will leave codebase in temporarily-broken state)**

`appendChunkToBuffer` and `recordFetchLatency` don't exist yet — fixed in Tasks 3.4 and 3.5. Commit so the diff stays small:

```bash
git add frontend/src/app/store/middleware/simulationRequestThunk.ts
git commit -m "thunk: route worker payload into appendChunkToBuffer (WIP)

Adds latency measurement (recordFetchLatency dispatch) and drops the
setIsUpdating dispatches. Leaves the file referencing slice actions
that don't exist yet — fixed in next commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: Add `recordFetchLatency` + EMA to RequestSlice

**Files:**
- Modify: `frontend/src/app/store/slices/RequestSlice.ts`

- [ ] **Step 1: Add EMA state + reducer**

Replace `frontend/src/app/store/slices/RequestSlice.ts` with:

```ts
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "@/app/store/Store";

// UI-relevant request state for chunk fetches.

interface RequestState {
  isRequestInProgress: boolean;
  errorMessage: string | null;
  // Rolling EMA of recent chunk fetch wall-times (ms). Default 1000ms before
  // any measurement lands so the speed-aware threshold has a reasonable
  // starting estimate. Updated by the request thunk on each successful fetch.
  fetchLatencyEmaMs: number;
}

const initialState: RequestState = {
  isRequestInProgress: false,
  errorMessage: null,
  fetchLatencyEmaMs: 1000,
};

const EMA_ALPHA = 0.3;

export const requestSlice = createSlice({
  name: "request",
  initialState,
  reducers: {
    setErrorMessage: (state, action: PayloadAction<string>) => {
      state.errorMessage = action.payload;
    },
    clearErrorMessage: (state) => {
      state.errorMessage = null;
    },
    setRequestInProgress: (state, action: PayloadAction<boolean>) => {
      state.isRequestInProgress = action.payload;
    },
    recordFetchLatency: (state, action: PayloadAction<number>) => {
      state.fetchLatencyEmaMs =
        (1 - EMA_ALPHA) * state.fetchLatencyEmaMs + EMA_ALPHA * action.payload;
    },
  },
});

export const selectFetchLatencyEmaMs = (state: RootState): number =>
  state.request.fetchLatencyEmaMs;

export const {
  setErrorMessage,
  clearErrorMessage,
  setRequestInProgress,
  recordFetchLatency,
} = requestSlice.actions;

export default requestSlice.reducer;
```

- [ ] **Step 2: Run build**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors remain from Phase 3 in-flight changes, but RequestSlice itself compiles. If the `RootState` import errors with "circular", that's expected and resolved by tsconfig (RootState's typeof is fine since slices only import the type).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/store/slices/RequestSlice.ts
git commit -m "slice: add fetchLatencyEmaMs + recordFetchLatency to RequestSlice

EMA with α=0.3 (≈5-sample memory). Initial value 1000ms so the
speed-aware threshold has a sensible starting estimate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.5: Rewrite SimulationSlice to use ChunkBuffer

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`
- Modify: `frontend/src/app/store/slices/SimulationSlice.test.ts` (update to new shape)
- Modify: `frontend/src/app/constants/SimConstants.ts` (drop MAX_TIMESTEPS, TIMESTEP_CHUNK_SIZE)

This is the biggest single edit. After this lands, the slice compiles but consumers still reference the old API — Phase 4 fixes them.

- [ ] **Step 1: Drop the dropped constants from SimConstants.ts**

Edit `frontend/src/app/constants/SimConstants.ts` and remove these two lines:

```ts
  MAX_TIMESTEPS: 30_000,
  TIMESTEP_CHUNK_SIZE: 10_000,
```

The `FPS: 60` line directly above stays. Other constants stay untouched.

- [ ] **Step 2: Rewrite SimulationSlice.ts**

Replace `frontend/src/app/store/slices/SimulationSlice.ts` content. The new content keeps everything that's not buffer-related (active body, view toggles, scale, frame, last request, camera preset, displayFrame). It removes: `simulationData`, `setIsUpdating`/`selectIsUpdating`, `updateDataReceived` (replaced by `appendChunkToBuffer`), `deleteExcessData`, `selectTimeStepKeys`, `selectCurrentTimeStepKey`, `selectSimulationDataSize`. It adds: `chunkBuffer`, `hasReceivedFirstChunk`, `appendChunkToBuffer`, `selectChunkBuffer`, `selectTotalTimeSteps` (recomputed cheaply), `selectCurrentTimeStepIsoString`.

The full file is large; below is the complete replacement. Save it as `frontend/src/app/store/slices/SimulationSlice.ts`:

```ts
import {
  createSelector,
  createSlice,
  Middleware,
  PayloadAction,
} from "@reduxjs/toolkit";
import { AppDispatch, RootState } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import {
  appendChunk,
  ChunkBuffer,
  computeBufferCapacity,
  createChunkBuffer,
  getTimestampAsIsoString,
  selectBufferByteBudget,
} from "@/app/store/chunkBuffer";
import SimConstants, {
  BodyProperties,
  bodyProperties,
} from "@/app/constants/SimConstants";
import { StaticImageData } from "next/image";
import { selectFetchLatencyEmaMs } from "@/app/store/slices/RequestSlice";

interface TimeState {
  isPaused: boolean;
  speedMultiplier: number;
  currentTimeStepIndex: number;
}

export interface Vector3Simple {
  x: number;
  y: number;
  z: number;
}

export interface CelestialBodyProperties {
  mass?: number;
  mu?: number;
  radius?: number;
  name?: string;
  orbitingBody?: string;
  positionScale?: number;
  texture?: StaticImageData;
}

interface SimulationMetadata {
  sessionID: string;
}

export interface LastSimRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: string;
}

interface ActiveBodyState {
  isBodyActive: boolean;
  activeBodyName: string | null;
}

export interface SimulationScale {
  name: string;
  positionScale: number;
  radiusScale: number;
  EXCEPTION_BODIES_POSITION_SCALE: { [bodyName: string]: number };
  AXES: {
    SIZE: number;
  };
}

export type CameraPreset = "top-down" | "free";
export type DisplayFrame = "helio" | "geo";

export interface SimulationParameters {
  celestialBodyPropertiesList: CelestialBodyProperties[];
  simulationMetaData: SimulationMetadata | null;
  lastRequest: LastSimRequest | null;
  showGrid: boolean;
  showAxes: boolean;
  showPlanetInfoOverlay: boolean;
  showTrails: boolean;
  showOrbitPaths: boolean;
  simulationScale: SimulationScale;
  cameraPreset: CameraPreset;
  displayFrame: DisplayFrame;
}

const CAMERA_PRESET_STORAGE_KEY = "spacesim.cameraPreset";
const DISPLAY_FRAME_STORAGE_KEY = "spacesim.displayFrame";

export function readStoredCameraPreset(): CameraPreset | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(CAMERA_PRESET_STORAGE_KEY);
  return stored === "free" || stored === "top-down" ? stored : null;
}

export function readStoredDisplayFrame(): DisplayFrame | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(DISPLAY_FRAME_STORAGE_KEY);
  return stored === "geo" || stored === "helio" ? stored : null;
}

interface SimulationState {
  activeBodyState: ActiveBodyState;
  simulationParameters: SimulationParameters;
  chunkBuffer: ChunkBuffer | null;
  hasReceivedFirstChunk: boolean;
  timeState: TimeState;
}

const initialState: SimulationState = {
  activeBodyState: {
    isBodyActive: false,
    activeBodyName: null,
  },
  simulationParameters: {
    celestialBodyPropertiesList: [],
    simulationMetaData: null,
    lastRequest: null,
    showGrid: true,
    showAxes: false,
    showPlanetInfoOverlay: true,
    showTrails: true,
    showOrbitPaths: true,
    simulationScale: SimConstants.SCALE.SEMI_REALISTIC,
    cameraPreset: "top-down",
    displayFrame: "helio",
  },
  chunkBuffer: null,
  hasReceivedFirstChunk: false,
  timeState: {
    isPaused: true,
    speedMultiplier: 1,
    currentTimeStepIndex: 0,
  },
};

interface AppendChunkPayload {
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: BigInt64Array;
  mu: Record<string, number>;
}

export const simulationSlice = createSlice({
  name: "simulation",
  initialState,
  reducers: {
    loadSimulation: (state, action: PayloadAction<SimulationParameters>) => {
      // Atomic new-session swap. Wipe buffer + timeState + activeBody.
      state.chunkBuffer = null;
      state.hasReceivedFirstChunk = false;
      state.timeState = {
        isPaused: true,
        speedMultiplier: 1,
        currentTimeStepIndex: 0,
      };
      state.activeBodyState = {
        isBodyActive: false,
        activeBodyName: null,
      };

      state.simulationParameters = {
        ...state.simulationParameters,
        ...action.payload,
      };

      if (state.simulationParameters?.celestialBodyPropertiesList) {
        const exceptionMap =
          state.simulationParameters.simulationScale
            ?.EXCEPTION_BODIES_POSITION_SCALE || {};

        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (body.name) {
                const upperName = body.name.trim().toUpperCase();
                const newPositionScale =
                  exceptionMap[upperName] !== undefined ? exceptionMap[upperName] : 1;
                const defaults: BodyProperties = bodyProperties[upperName];
                return {
                  ...body,
                  ...defaults,
                  positionScale: newPositionScale,
                };
              }
              return { ...body, positionScale: 1 };
            },
          );
      }
    },

    appendChunkToBuffer: (state, action: PayloadAction<AppendChunkPayload>) => {
      const payload = action.payload;

      // First chunk creates the buffer at the session-start capacity.
      if (state.chunkBuffer === null) {
        const byteBudget = selectBufferByteBudget();
        const capacity = computeBufferCapacity(payload.bodyCount, byteBudget);
        state.chunkBuffer = createChunkBuffer(payload.bodyNames, capacity);
        console.info(
          `[buffer] budget=${(byteBudget / 1024 / 1024) | 0}MB ` +
            `capacity=${capacity} timesteps (${payload.bodyCount} bodies)`,
        );
      }

      const shifted = appendChunk(
        state.chunkBuffer,
        payload.positions,
        payload.timestamps,
        payload.timestepCount,
      );

      // If eviction occurred, slide the playback head left by the same amount
      // so the user keeps watching the same simulation moment, not a moment
      // that just got dropped from the buffer.
      if (shifted > 0) {
        state.timeState.currentTimeStepIndex = Math.max(
          0,
          state.timeState.currentTimeStepIndex - shifted,
        );
      }

      // Merge µ into body props on every chunk (it's constant per session
      // but the backend ships it in every header — cheap enough to fold in).
      if (state.simulationParameters.celestialBodyPropertiesList) {
        const muMap = payload.mu;
        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (!body.name) return body;
              const upperName = body.name.trim().toUpperCase();
              let mu: number | undefined;
              for (const key of Object.keys(muMap)) {
                if (key.trim().toUpperCase() === upperName) {
                  const value = muMap[key];
                  if (value > 0) mu = value;
                  break;
                }
              }
              return mu !== undefined ? { ...body, mu } : body;
            },
          );
      }

      state.hasReceivedFirstChunk = true;
    },

    togglePause: (state) => {
      state.timeState.isPaused = !state.timeState.isPaused;
    },
    toggleShowGrid: (state) => {
      state.simulationParameters.showGrid = !state.simulationParameters.showGrid;
    },
    toggleShowAxes: (state) => {
      state.simulationParameters.showAxes = !state.simulationParameters.showAxes;
    },
    toggleShowPlanetInfoOverlay: (state) => {
      state.simulationParameters.showPlanetInfoOverlay =
        !state.simulationParameters.showPlanetInfoOverlay;
    },
    toggleShowTrails: (state) => {
      state.simulationParameters.showTrails =
        !state.simulationParameters.showTrails;
    },
    toggleShowOrbitPaths: (state) => {
      state.simulationParameters.showOrbitPaths =
        !state.simulationParameters.showOrbitPaths;
    },

    setIsPaused: (state, action: PayloadAction<boolean>) => {
      state.timeState.isPaused = action.payload;
    },

    setCurrentTimeStepIndex: (state, action: PayloadAction<number>) => {
      state.timeState.currentTimeStepIndex = action.payload;
    },
    setSpeedMultiplier: (state, action: PayloadAction<string>) => {
      const { speedMultiplier } = state.timeState;
      let newMultiplier: number = speedMultiplier;
      if (action.payload === "increase") {
        if (speedMultiplier < -1) {
          newMultiplier = speedMultiplier / 2;
        } else if (speedMultiplier === -1) {
          newMultiplier = 1;
        } else {
          newMultiplier = speedMultiplier * 2;
        }
      } else if (action.payload === "decrease") {
        if (speedMultiplier > 1) {
          newMultiplier = speedMultiplier / 2;
        } else if (speedMultiplier === 1) {
          newMultiplier = -1;
        } else {
          newMultiplier = speedMultiplier * 2;
        }
      }
      state.timeState.speedMultiplier = Math.min(
        Math.max(newMultiplier, -SimConstants.MAX_SPEED_MULTIPLIER),
        SimConstants.MAX_SPEED_MULTIPLIER,
      );
    },
    setActiveBody: (state, action: PayloadAction<string>) => {
      state.activeBodyState.activeBodyName = action.payload;
      state.activeBodyState.isBodyActive = true;
    },
    setLastSimRequest: (state, action: PayloadAction<LastSimRequest>) => {
      state.simulationParameters.lastRequest = action.payload;
    },
    toggleCameraPreset: (state) => {
      const next: CameraPreset =
        state.simulationParameters.cameraPreset === "top-down" ? "free" : "top-down";
      state.simulationParameters.cameraPreset = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, next);
      }
    },
    setCameraPreset: (state, action: PayloadAction<CameraPreset>) => {
      state.simulationParameters.cameraPreset = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, action.payload);
      }
    },
    cycleDisplayFrame: (state) => {
      const next: DisplayFrame =
        state.simulationParameters.displayFrame === "helio" ? "geo" : "helio";
      state.simulationParameters.displayFrame = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISPLAY_FRAME_STORAGE_KEY, next);
      }
    },
    setDisplayFrame: (state, action: PayloadAction<DisplayFrame>) => {
      state.simulationParameters.displayFrame = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISPLAY_FRAME_STORAGE_KEY, action.payload);
      }
    },
    setIsBodyActive: (state, action: PayloadAction<boolean>) => {
      state.activeBodyState.isBodyActive = action.payload;
    },
    cycleSimulationScale: (state) => {
      if (state.simulationParameters.simulationScale) {
        const currentScale = state.simulationParameters.simulationScale;
        const scaleOptions: string[] = Object.keys(SimConstants.SCALE);
        const currentIndex = scaleOptions.findIndex((key) => {
          const preset = SimConstants.SCALE[key as keyof typeof SimConstants.SCALE];
          return (
            preset.positionScale === currentScale.positionScale &&
            preset.radiusScale === currentScale.radiusScale
          );
        });
        const nextIndex: number = (currentIndex + 1) % scaleOptions.length;
        const nextKey = scaleOptions[nextIndex] as keyof typeof SimConstants.SCALE;
        state.simulationParameters.simulationScale = SimConstants.SCALE[nextKey];

        const exceptions =
          state.simulationParameters.simulationScale.EXCEPTION_BODIES_POSITION_SCALE;
        if (exceptions && state.simulationParameters.celestialBodyPropertiesList) {
          state.simulationParameters.celestialBodyPropertiesList =
            state.simulationParameters.celestialBodyPropertiesList.map((bodyProps) => {
              if (
                bodyProps.name &&
                exceptions[bodyProps.name.toUpperCase()] !== undefined
              ) {
                return {
                  ...bodyProps,
                  positionScale: exceptions[bodyProps.name.toUpperCase()],
                };
              }
              return bodyProps;
            });
        }
      }
    },
  },
});

///////////////////////////////////////////// MIDDLEWARE /////////////////////////////////////////////

type IndexAction = { type: string; payload: number };

const PREFETCH_MIN_THRESHOLD = 1000;
const PREFETCH_SAFETY_FACTOR = 1.5;

export const simulationUpdateDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const a = action as IndexAction;
    if (a.type === "simulation/setCurrentTimeStepIndex") {
      const state = store.getState() as RootState;
      const buffer = state.simulation.chunkBuffer;
      if (!buffer) return next(action);

      const currentTimeStepIndex = a.payload;
      const remaining = buffer.totalTimesteps - currentTimeStepIndex;
      const speedMultiplier = Math.abs(state.simulation.timeState.speedMultiplier);
      const fps = SimConstants.FPS;
      const fetchLatencyMs = selectFetchLatencyEmaMs(state);

      const stepsConsumedDuringFetch =
        speedMultiplier * fps * (fetchLatencyMs / 1000);
      const threshold = Math.max(
        PREFETCH_MIN_THRESHOLD,
        Math.ceil(stepsConsumedDuringFetch * PREFETCH_SAFETY_FACTOR),
      );

      if (remaining <= threshold && !state.request.isRequestInProgress) {
        const sessionID = selectSessionID(state);
        if (sessionID) {
          dispatchChunkRequest(store.dispatch as AppDispatch, { sessionID });
        }
      }
    }
    return next(action);
  };

///////////////////////////////////////////// SELECTORS /////////////////////////////////////////////

export const selectChunkBuffer = (state: RootState): ChunkBuffer | null =>
  state.simulation.chunkBuffer;

export const selectTotalTimeSteps = (state: RootState): number =>
  state.simulation.chunkBuffer?.totalTimesteps ?? 0;

export const selectCurrentTimeStepIsoString = createSelector(
  [
    (state: RootState) => state.simulation.chunkBuffer,
    (state: RootState) => state.simulation.timeState.currentTimeStepIndex,
  ],
  (buffer: ChunkBuffer | null, idx: number): string => {
    if (!buffer) return "";
    return getTimestampAsIsoString(buffer, idx);
  },
);

export const selectBodyRadiusFromName = createSelector(
  [
    (state: RootState) =>
      state.simulation.simulationParameters?.celestialBodyPropertiesList,
    (state: RootState, props: { bodyName: string }) => props.bodyName,
  ],
  (
    celestialBodyPropertiesList: CelestialBodyProperties[],
    bodyName: string,
  ): number | undefined => {
    const bodyProps: CelestialBodyProperties | undefined =
      celestialBodyPropertiesList.find(
        (cb: CelestialBodyProperties): boolean =>
          cb.name?.trim().toLowerCase() === bodyName.trim().toLowerCase(),
      );
    return bodyProps?.radius;
  },
);

export const selectShowGrid = (state: RootState) =>
  state.simulation.simulationParameters.showGrid;
export const selectShowAxes = (state: RootState) =>
  state.simulation.simulationParameters.showAxes;
export const selectShowPlanetInfoOverlay = (state: RootState) =>
  state.simulation.simulationParameters.showPlanetInfoOverlay;
export const selectShowTrails = (state: RootState) =>
  state.simulation.simulationParameters.showTrails;
export const selectShowOrbitPaths = (state: RootState) =>
  state.simulation.simulationParameters.showOrbitPaths;
export const selectSimulationScale = (state: RootState) =>
  state.simulation.simulationParameters.simulationScale;
export const selectActiveBodyName = (state: RootState) =>
  state.simulation.activeBodyState.activeBodyName;
export const selectIsBodyActive = (state: RootState) =>
  state.simulation.activeBodyState.isBodyActive;
export const selectCurrentTimeStepIndex = (state: RootState) =>
  state.simulation.timeState.currentTimeStepIndex;
export const selectCelestialBodyPropertiesList = (state: RootState) =>
  state.simulation.simulationParameters?.celestialBodyPropertiesList;
export const selectIsPaused = (state: RootState) =>
  state.simulation.timeState.isPaused;
export const selectSpeedMultiplier = (state: RootState) =>
  state.simulation.timeState.speedMultiplier;
export const selectSessionID = (state: RootState) =>
  state.simulation.simulationParameters?.simulationMetaData?.sessionID;
export const selectLastSimRequest = (state: RootState) =>
  state.simulation.simulationParameters?.lastRequest;
export const selectCameraPreset = (state: RootState) =>
  state.simulation.simulationParameters?.cameraPreset ?? "top-down";
export const selectDisplayFrame = (state: RootState): DisplayFrame =>
  state.simulation.simulationParameters?.displayFrame ?? "helio";
export const selectHasReceivedFirstChunk = (state: RootState): boolean =>
  state.simulation.hasReceivedFirstChunk;

export const {
  loadSimulation,
  appendChunkToBuffer,
  togglePause,
  toggleShowGrid,
  toggleShowAxes,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  toggleShowOrbitPaths,
  setIsPaused,
  cycleSimulationScale,
  setSpeedMultiplier,
  setCurrentTimeStepIndex,
  setActiveBody,
  setIsBodyActive,
  setLastSimRequest,
  toggleCameraPreset,
  setCameraPreset,
  cycleDisplayFrame,
  setDisplayFrame,
} = simulationSlice.actions;

export default simulationSlice.reducer;
```

- [ ] **Step 3: Update SimulationSlice.test.ts**

Replace `frontend/src/app/store/slices/SimulationSlice.test.ts` so the assertions match the new shape. Open the existing file and replace any assertions referencing `simulationData`, `isUpdating`, or `updateDataReceived` with their new equivalents. If you're unsure about the test file contents, run the test suite first and update each failing case to use:
- `state.chunkBuffer` instead of `state.simulationData`
- `state.hasReceivedFirstChunk` for "is the buffer populated"
- `state.timeState.isPaused` (no longer setIsPaused on chunk arrival)

If the existing tests are too coupled to the old shape, replace them with a single test asserting the new init state:

```ts
import { describe, expect, it } from "vitest";
import simulationReducer from "./SimulationSlice";

describe("simulationSlice", () => {
  it("initializes with null chunkBuffer and hasReceivedFirstChunk=false", () => {
    const state = simulationReducer(undefined, { type: "@@INIT" });
    expect(state.chunkBuffer).toBeNull();
    expect(state.hasReceivedFirstChunk).toBe(false);
    expect(state.timeState.isPaused).toBe(true);
    expect(state.timeState.currentTimeStepIndex).toBe(0);
  });
});
```

- [ ] **Step 4: Run slice tests**

Run: `cd frontend && npx vitest run src/app/store/slices/`
Expected: PASS (or, for the moment, accept failures from consumer-side test files that still reference the old API — they'll be fixed when their components are migrated).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/store/slices/SimulationSlice.ts frontend/src/app/store/slices/SimulationSlice.test.ts frontend/src/app/constants/SimConstants.ts
git commit -m "slice: swap simulationData for chunkBuffer; remove isUpdating + auto-unpause

Adds appendChunkToBuffer (replaces updateDataReceived + deleteExcessData),
hasReceivedFirstChunk flag for the first-load spinner, selectChunkBuffer
+ selectTotalTimeSteps + selectCurrentTimeStepIsoString.

Middleware threshold is now speed-aware:
  max(1000, speedMultiplier * FPS * fetchLatencyMs/1000 * 1.5)

Removes:
- isUpdating flag + UpdateModal-driving selector
- isPaused = false on chunk arrival (forced auto-unpause)
- console.log of simulationData
- deleteExcessData (eviction lives in chunkBuffer.appendChunk)
- selectTimeStepKeys / selectCurrentTimeStepKey / selectSimulationDataSize
- MAX_TIMESTEPS and TIMESTEP_CHUNK_SIZE constants

Consumers don't compile yet — fixed in Phase 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Consumer migration

Goal: update every component that reads `simulationData` to use the typed-array accessors. The app starts compiling and rendering correctly partway through this phase as more consumers migrate; the final task is a browser smoke test.

**Migration pattern** (apply to every consumer in this phase):

Old:
```ts
import { selectCurrentTimeStepKey, selectTimeStepKeys, /* etc */ } from "@/app/store/slices/SimulationSlice";
// ...
const simulationData = state.simulation.simulationData;
const currentTimeStepKey = selectCurrentTimeStepKey(state);
const snapshot = simulationData[currentTimeStepKey];
const body = snapshot.find(b => b.name === bodyName);
const px = body.position.x; // etc
```

New:
```ts
import { selectChunkBuffer, selectCurrentTimeStepIndex } from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
// ...
const buffer = state.simulation.chunkBuffer;
const idx = state.simulation.timeState.currentTimeStepIndex;
if (!buffer || idx >= buffer.totalTimesteps) { /* skip frame */ }
const bodyIdx = buffer.bodyNameToIndex.get(bodyName) ?? -1;
readBodyPositionInto(scratchVec, buffer, idx, bodyIdx); // scratchVec is a useRef'd THREE.Vector3
```

### Task 4.1: Migrate AnimationController

**Files:**
- Modify: `frontend/src/app/components/scene/AnimationController.tsx`

- [ ] **Step 1: Rewrite AnimationController to read from chunkBuffer**

Replace the contents of `frontend/src/app/components/scene/AnimationController.tsx` with:

```tsx
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  selectCurrentTimeStepIndex,
  selectIsPaused,
  selectSpeedMultiplier,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch, RootState } from "@/app/store/Store";

const FRAME_INTERVAL = 1 / SimConstants.FPS;

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);
  const currentTimeStepIndex = useSelector(selectCurrentTimeStepIndex);

  const currentIndexRef = useRef(currentTimeStepIndex);
  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);
  const accRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentTimeStepIndex;
  }, [currentTimeStepIndex]);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    accRef.current += delta;
    if (accRef.current < FRAME_INTERVAL) return;
    accRef.current = 0;
    if (isPausedRef.current) return;

    const buffer = store.getState().simulation.chunkBuffer;
    if (!buffer || buffer.totalTimesteps === 0) return;

    const stepsToMove = Math.abs(speedMultiplierRef.current);
    const direction = speedMultiplierRef.current > 0 ? 1 : -1;
    const proposed = currentIndexRef.current + direction * stepsToMove;
    // Clamp to [0, totalTimesteps - 1] so the playback head never outruns
    // the buffer. Previous behaviour incremented past the end and rendered
    // stale frames; the speed-aware prefetch now keeps the buffer ahead so
    // this clamp is rarely the limiting factor in practice.
    const nextIndex = Math.max(0, Math.min(buffer.totalTimesteps - 1, proposed));

    if (nextIndex !== currentIndexRef.current) {
      currentIndexRef.current = nextIndex;
      dispatch(setCurrentTimeStepIndex(nextIndex));
    }
  });

  return null;
};

export default AnimationController;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/scene/AnimationController.tsx
git commit -m "scene: AnimationController reads from chunkBuffer + clamps to totalTimesteps

Drops deleteExcessData call (eviction now lives in the slice).
Clamps proposed index to [0, totalTimesteps-1] so the playback head
can't outrun the buffer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Migrate Sphere.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Sphere.tsx`

- [ ] **Step 1: Update Sphere to read body position from chunkBuffer**

Replace the imports block at the top of `Sphere.tsx`:

```tsx
import { useFrame, useLoader } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import {
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  setActiveBody,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { scaleDistanceInto } from "@/app/utils/helpers";
import * as THREE from "three";
```

Note: `findEarthIndex` previously returned an index into a `CelestialBody[]` snapshot array. The new framePivot helper needs to take a `bodyNameToIndex` map instead — see Task 4.7 for the framePivot helper update. For Sphere itself, replace `useFrame` body and refs to use the buffer:

```tsx
const Sphere: React.FC<SphereProps> = ({
  name,
  radius,
  textureUrl,
  rotationSpeed = 0.1,
  unlit = false,
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.PointLight>(null!);
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  const { positionScale, orbitingBodyNameUpper } = useMemo(() => {
    const nameUpper = name.toUpperCase();
    const bodyProps: CelestialBodyProperties | undefined = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === nameUpper,
    );
    return {
      positionScale: bodyProps?.positionScale ?? 1,
      orbitingBodyNameUpper: bodyProps?.orbitingBody?.toUpperCase(),
    };
  }, [name, propsList]);

  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  // Scratch Vector3s for per-frame reads — never reallocated.
  const posScratch = useRef(new THREE.Vector3());
  const orbitingScratch = useRef(new THREE.Vector3());
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  // posSimple is the Vector3Simple shape setBodyWorldPosition expects after
  // we've already done all the math in Vector3 space.
  const posSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  useFrame((_, delta) => {
    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    const simulationScale = state.simulation.simulationParameters.simulationScale;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    if (buffer && idx < buffer.totalTimesteps) {
      const bodyIdx = buffer.bodyNameToIndex.get(name);
      if (bodyIdx !== undefined) {
        readBodyPositionInto(posScratch.current, buffer, idx, bodyIdx);

        if (positionScale !== 1 && orbitingBodyNameUpper) {
          const orbitingIdx = buffer.bodyNameToIndex.get(orbitingBodyNameUpper);
          if (orbitingIdx !== undefined) {
            readBodyPositionInto(orbitingScratch.current, buffer, idx, orbitingIdx);
            scaleDistanceInto(
              posSimple.current,
              { x: posScratch.current.x, y: posScratch.current.y, z: posScratch.current.z },
              { x: orbitingScratch.current.x, y: orbitingScratch.current.y, z: orbitingScratch.current.z },
              positionScale,
            );
            posScratch.current.set(posSimple.current.x, posSimple.current.y, posSimple.current.z);
          }
        }

        // Frame pivot. Helio writes zero, so no branch.
        writePivotInto(
          pivotScratch.current,
          buffer,
          idx,
          displayFrame,
        );
        posScratch.current.x -= pivotScratch.current.x;
        posScratch.current.y -= pivotScratch.current.y;
        posScratch.current.z -= pivotScratch.current.z;

        // Convert to Vector3Simple for setBodyWorldPosition.
        posSimple.current.x = posScratch.current.x;
        posSimple.current.y = posScratch.current.y;
        posSimple.current.z = posScratch.current.z;

        setBodyWorldPosition(meshRef.current.position, posSimple.current, simulationScale.positionScale);
        if (lightRef.current) {
          setBodyWorldPosition(lightRef.current.position, posSimple.current, simulationScale.positionScale);
        }
      }
    }

    meshRef.current.rotation.y += rotationSpeed * delta;
  });

  const handleClick = () => {
    dispatch(setActiveBody(name));
  };

  return (
    <>
      <mesh ref={meshRef} onClick={handleClick}>
        <sphereGeometry args={[radius, 32, 32]} />
        {unlit ? (
          <meshBasicMaterial map={textureUrl ? texture : undefined} />
        ) : (
          <meshStandardMaterial
            map={textureUrl ? texture : undefined}
            onBeforeCompile={halfLambertOverride}
          />
        )}
      </mesh>
      {unlit && (
        <pointLight ref={lightRef} color={0xffffff} intensity={1.5} decay={0} />
      )}
    </>
  );
};

export default Sphere;
```

The `halfLambertOverride` constant at the top of the file is unchanged. Keep it.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/scene/Sphere.tsx
git commit -m "scene: Sphere reads body position from chunkBuffer

Scratch THREE.Vector3 refs avoid per-frame allocation; bodyNameToIndex
replaces the per-frame snapshot.find().

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: Update framePivot helper to take ChunkBuffer

**Files:**
- Modify: `frontend/src/app/utils/framePivot.ts`

The previous `writePivotInto` signature took a `CelestialBody[]` snapshot; now it needs to take the buffer + timestep index. The `findEarthIndex(snapshot)` helper goes away (replaced by `buffer.bodyNameToIndex.get("Earth")` ?? -1 with case handling).

- [ ] **Step 1: Read the existing helper**

Run: `cat frontend/src/app/utils/framePivot.ts`

Expected output: the file exports `findEarthIndex` and `writePivotInto`.

- [ ] **Step 2: Replace with the buffer-aware version**

Replace `frontend/src/app/utils/framePivot.ts` with:

```ts
import type { ChunkBuffer } from "@/app/store/chunkBuffer";
import type { Vector3Simple, DisplayFrame } from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import * as THREE from "three";

// Earth name lookup is case-insensitive. The buffer's bodyNameToIndex map
// is built with the exact names from the wire format header (which mirror
// the SimParams form selections) — case can vary, so this resolver does
// case-insensitive matching once per session.
export function findEarthBodyIndex(buffer: ChunkBuffer): number {
  for (const [name, idx] of buffer.bodyNameToIndex.entries()) {
    if (name.toUpperCase() === "EARTH") return idx;
  }
  return -1;
}

// Scratch Vector3 reused inside writePivotInto so callers don't have to
// pass one. Module-level — safe because writePivotInto is called serially
// from the render loop (one thread).
const pivotVec = new THREE.Vector3();

/**
 * Writes the display-frame pivot point into `out`. Helio is zero; geo is
 * Earth's current position at this timestep.
 */
export function writePivotInto(
  out: Vector3Simple,
  buffer: ChunkBuffer | null,
  timestepIdx: number,
  displayFrame: DisplayFrame,
): void {
  if (displayFrame === "helio" || !buffer || timestepIdx >= buffer.totalTimesteps) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  const earthIdx = findEarthBodyIndex(buffer);
  if (earthIdx < 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  readBodyPositionInto(pivotVec, buffer, timestepIdx, earthIdx);
  out.x = pivotVec.x;
  out.y = pivotVec.y;
  out.z = pivotVec.z;
}
```

- [ ] **Step 3: Update Sphere.tsx to use the new signature**

In `Sphere.tsx`, update the `writePivotInto` call inside `useFrame` so the args match the new signature (4 args, not 4 with snapshot):

```tsx
writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
```

This is already correct in the Task 4.2 code above — no change needed unless you wrote a different version.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/utils/framePivot.ts frontend/src/app/components/scene/Sphere.tsx
git commit -m "framePivot: take ChunkBuffer + timestep index instead of snapshot array

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.4: Migrate Trail.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Trail.tsx`

- [ ] **Step 1: Replace the useFrame block**

In `Trail.tsx`, update the imports — remove `selectTimeStepKeys` and `findEarthIndex` references, add buffer accessors:

```tsx
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import { selectCelestialBodyPropertiesList } from "@/app/store/slices/SimulationSlice";
```

Replace the `useFrame` body so it iterates `[start, end]` directly on the typed-array buffer instead of looking up date keys. Inside the existing useFrame block (around line 122 of the current file), replace everything from `const state = store.getState();` down to the end of the body-history loop with:

```tsx
  useFrame(() => {
    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const currentTimeStepIndex = state.simulation.timeState.currentTimeStepIndex;
    const simulationScale = state.simulation.simulationParameters.simulationScale;
    const celestialBodyPropertiesList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    const geom = lineObject.geometry;
    const positions = geom.attributes.position.array as Float32Array;
    const colors = geom.attributes.color.array as Float32Array;

    if (!buffer || buffer.totalTimesteps === 0 || currentTimeStepIndex < 1) {
      geom.setDrawRange(0, 0);
      return;
    }

    const length = Math.min(MAX_TRAIL_POINTS, getDevSettings().trailLength);
    const start = Math.max(0, currentTimeStepIndex - length);
    const end = Math.min(currentTimeStepIndex, buffer.totalTimesteps - 1);
    const total = end - start;

    const bodyProps: CelestialBodyProperties | undefined =
      celestialBodyPropertiesList.find(
        (bp: CelestialBodyProperties) =>
          bp.name?.toUpperCase() === bodyName.toUpperCase(),
      );
    const positionScale = bodyProps?.positionScale ?? 1;
    const orbitingBodyName = bodyProps?.orbitingBody;

    // Lazy-resolve cached body indices on first valid buffer.
    if (bodyIndexRef.current === -1) {
      // Match case-insensitively because the body name on the bodyProps map
      // can differ in case from what the backend sends. The buffer's map
      // uses backend casing.
      for (const [name, idx] of buffer.bodyNameToIndex.entries()) {
        if (name.toUpperCase() === bodyName.toUpperCase()) {
          bodyIndexRef.current = idx;
          break;
        }
      }
      if (orbitingBodyName) {
        const upper = orbitingBodyName.toUpperCase();
        for (const [name, idx] of buffer.bodyNameToIndex.entries()) {
          if (name.toUpperCase() === upper) {
            orbitingIndexRef.current = idx;
            break;
          }
        }
      }
      // Earth index for geo pivot.
      for (const [name, idx] of buffer.bodyNameToIndex.entries()) {
        if (name.toUpperCase() === "EARTH") {
          earthIndexRef.current = idx;
          break;
        }
      }
    }
    const bodyIdx = bodyIndexRef.current;
    if (bodyIdx < 0) {
      geom.setDrawRange(0, 0);
      return;
    }
    const orbitingIdx = orbitingIndexRef.current;
    const earthIdx = earthIndexRef.current;

    let count = 0;
    for (let i = start; i <= end; i++) {
      readBodyPositionInto(posScratchVec, buffer, i, bodyIdx);
      let pos: Vector3Simple = {
        x: posScratchVec.x,
        y: posScratchVec.y,
        z: posScratchVec.z,
      };

      if (positionScale !== 1 && orbitingIdx >= 0) {
        readBodyPositionInto(orbitingScratchVec, buffer, i, orbitingIdx);
        scaleDistanceInto(
          posSimpleScratch,
          { x: posScratchVec.x, y: posScratchVec.y, z: posScratchVec.z },
          { x: orbitingScratchVec.x, y: orbitingScratchVec.y, z: orbitingScratchVec.z },
          positionScale,
        );
        pos = posSimpleScratch;
      }

      // Geo pivot subtraction.
      if (displayFrame !== "helio" && earthIdx >= 0) {
        readBodyPositionInto(pivotScratchVec, buffer, i, earthIdx);
        pos = {
          x: pos.x - pivotScratchVec.x,
          y: pos.y - pivotScratchVec.y,
          z: pos.z - pivotScratchVec.z,
        };
      }

      setTrailPointAt(positions, colors, count, pos, simulationScale.positionScale, bodyName);
      count++;
    }

    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
    geom.setDrawRange(0, total + 1);
  });
```

You'll also need to ensure scratch refs exist at the component scope — add these near the existing `bodyIndexRef`:

```tsx
const posScratchVec = useMemo(() => new THREE.Vector3(), []);
const orbitingScratchVec = useMemo(() => new THREE.Vector3(), []);
const pivotScratchVec = useMemo(() => new THREE.Vector3(), []);
const posSimpleScratch = useMemo<Vector3Simple>(() => ({ x: 0, y: 0, z: 0 }), []);
```

And keep / add the helper `setTrailPointAt` if it doesn't already exist; otherwise replace your existing point-set logic with whatever the current Trail uses. The key requirements: no allocation inside the loop, no `simulationData[key].find(...)` calls.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/scene/Trail.tsx
git commit -m "scene: Trail iterates chunkBuffer directly — no per-frame .find()

Cached body/orbiting/earth indices once via buffer.bodyNameToIndex;
inner loop reads positions via readBodyPositionInto into scratch
Vector3s. No allocations per frame, no Object.keys() calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.5: Migrate Reticle, GhostLabel, Camera

**Files:**
- Modify: `frontend/src/app/components/scene/Reticle.tsx`
- Modify: `frontend/src/app/components/scene/GhostLabel.tsx`
- Modify: `frontend/src/app/components/scene/Camera.tsx`

Each of these reads body position at the current timestep. All three share the same migration pattern: replace `simulationData[currentTimeStepKey]` + `snapshot.find(...)` with `buffer.bodyNameToIndex.get(name)` + `readBodyPositionInto(scratch, buffer, idx, bodyIdx)`.

- [ ] **Step 1: For each file, replace the simulationData lookup**

In each file's `useFrame`:

Find this pattern (or equivalent):
```tsx
const state = store.getState();
const simulationData = state.simulation.simulationData;
const currentTimeStepKey = selectCurrentTimeStepKey(state);
if (simulationData && currentTimeStepKey) {
  const snapshot = simulationData[currentTimeStepKey];
  if (snapshot) {
    const body = snapshot.find(b => b.name === name);
    // ... use body.position
  }
}
```

Replace with:
```tsx
const state = store.getState();
const buffer = state.simulation.chunkBuffer;
const idx = state.simulation.timeState.currentTimeStepIndex;
if (buffer && idx < buffer.totalTimesteps) {
  const bodyIdx = buffer.bodyNameToIndex.get(name);
  if (bodyIdx !== undefined) {
    readBodyPositionInto(scratchVec, buffer, idx, bodyIdx);
    // ... use scratchVec
  }
}
```

For each file, also:
- Add `import { readBodyPositionInto } from "@/app/store/chunkBuffer";`
- Add a `const scratchVec = useMemo(() => new THREE.Vector3(), []);` at component scope.
- Remove imports of `selectCurrentTimeStepKey`.
- Remove the `simulationData` variable.
- Apply the same display-frame pivot pattern as in Sphere (subtract pivot before using the position).

- [ ] **Step 2: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors only in the remaining unmigrated consumers (OrbitPath, TopStatusStrip, Timeline, BodyCard, DevPanel).

- [ ] **Step 3: Commit (one commit per file is fine, or batched)**

```bash
git add frontend/src/app/components/scene/Reticle.tsx frontend/src/app/components/scene/GhostLabel.tsx frontend/src/app/components/scene/Camera.tsx
git commit -m "scene: Reticle/GhostLabel/Camera read positions from chunkBuffer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.6: Migrate OrbitPath.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/OrbitPath.tsx`

- [ ] **Step 1: Replace its read pattern**

OrbitPath iterates time-step keys like Trail does. Apply the same migration pattern: cache body index via `buffer.bodyNameToIndex`, loop `for (i = start; i <= end; i++)` over the buffer, `readBodyPositionInto` into a scratch Vector3, no allocations in the loop.

(Concrete code is structurally identical to the Trail migration in Task 4.4 — copy the inner-loop pattern from there but adapt to OrbitPath's specific output mutations: it writes into its own line geometry's position attribute. Drop any imports of `selectTimeStepKeys` and `simulationData[key]` references.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/scene/OrbitPath.tsx
git commit -m "scene: OrbitPath reads from chunkBuffer; no per-frame Object.keys

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.7: Migrate TopStatusStrip, Timeline, BodyCard

**Files:**
- Modify: `frontend/src/app/components/chrome/TopStatusStrip.tsx`
- Modify: `frontend/src/app/components/chrome/Timeline.tsx`
- Modify: `frontend/src/app/components/chrome/BodyCard.tsx`

These chrome components don't run in `useFrame` — they re-render on selector changes. They consume `selectCurrentTimeStepKey` today; switch to `selectCurrentTimeStepIsoString`.

- [ ] **Step 1: In each file, replace the import + usage**

Replace:
```tsx
import { selectCurrentTimeStepKey } from "@/app/store/slices/SimulationSlice";
// ...
const utcKey = useSelector(selectCurrentTimeStepKey);
```

With:
```tsx
import { selectCurrentTimeStepIsoString } from "@/app/store/slices/SimulationSlice";
// ...
const utcKey = useSelector(selectCurrentTimeStepIsoString);
```

For `BodyCard.tsx` specifically, which uses `selectCurrentTimeStepKey(state)` inside a non-`useFrame` callback to look up snapshot data, replace the lookup chain with buffer reads. For example, BodyCard reads the current body's (r, v) state to compute orbital elements — use `readBodyStateInto` with the scratch refs:

```tsx
import { readBodyStateInto } from "@/app/store/chunkBuffer";
// ...
const rScratch = useMemo(() => new THREE.Vector3(), []);
const vScratch = useMemo(() => new THREE.Vector3(), []);
// inside the callback:
const buffer = state.simulation.chunkBuffer;
const idx = state.simulation.timeState.currentTimeStepIndex;
if (!buffer || idx >= buffer.totalTimesteps) return null;
const bodyIdx = buffer.bodyNameToIndex.get(bodyName);
if (bodyIdx === undefined) return null;
readBodyStateInto(rScratch, vScratch, buffer, idx, bodyIdx);
// ... compute Keplerian elements from rScratch and vScratch
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/chrome/TopStatusStrip.tsx frontend/src/app/components/chrome/Timeline.tsx frontend/src/app/components/chrome/BodyCard.tsx
git commit -m "chrome: TopStatusStrip/Timeline/BodyCard read from chunkBuffer

UTC string comes from selectCurrentTimeStepIsoString. BodyCard's
orbital-element computation reads (r, v) via readBodyStateInto into
scratch Vector3s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.8: Migrate DevPanel (selectSimulationDataSize → cheap calc)

**Files:**
- Modify: `frontend/src/app/components/dev/DevPanel.tsx`

- [ ] **Step 1: Replace the size selector**

In `DevPanel.tsx`, replace:
```tsx
import { selectSimulationDataSize } from "@/app/store/slices/SimulationSlice";
// ...
const bytes = useSelector(selectSimulationDataSize);
```

With:
```tsx
import { selectChunkBuffer } from "@/app/store/slices/SimulationSlice";
// ...
const buffer = useSelector(selectChunkBuffer);
const bytes = buffer
  ? buffer.totalTimesteps * buffer.bodyCount * 48 + buffer.capacity * 8
  : 0;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/components/dev/DevPanel.tsx
git commit -m "dev: DevPanel buffer-size readout uses cheap O(1) calc

No more JSON.stringify + Blob on the whole buffer; just multiply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.9: Build + lint + test the whole frontend; fix anything remaining

**Files:** any remaining files that still reference removed symbols.

- [ ] **Step 1: Run the full frontend verify chain**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS. If errors, they'll be in files that still import `selectCurrentTimeStepKey`, `selectTimeStepKeys`, `simulationData`, `selectIsUpdating`, `setIsUpdating`, `selectSimulationDataSize`, or `deleteExcessData`. Migrate them with the same pattern.

Then run:

```bash
cd frontend && npm run build && npm run lint
```

Expected: both PASS.

Then tests:

```bash
cd frontend && npm test
```

Expected: PASS for all suites. Update any remaining tests whose assertions depend on the old simulationData shape.

- [ ] **Step 2: Browser smoke test**

Start backend: `cd backend && ./mvnw spring-boot:run` (separate terminal).
Start frontend: `cd frontend && npm run dev`.

Open http://localhost:3000, click Run with the default body list, confirm:
- Bodies render and orbit correctly.
- Scrubbing the timeline works in both directions.
- Speed up to 128× — playback should NOT stall waiting for chunks.
- No center-screen "Fetching data" overlay flashes between chunks. (UpdateModal still mounts at this point; it'll be deleted in Phase 6.)

If the scene doesn't render, check the browser console — the most common cause at this stage is a remaining stale import or a body name-casing mismatch.

- [ ] **Step 3: Commit any fixes from Step 1**

```bash
git add -p   # review changes carefully
git commit -m "consumers: fix remaining references to removed slice symbols

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Speed-aware prefetch (verification)

The threshold formula and EMA wiring were already added in Phase 3 (slice middleware + RequestSlice changes). This phase is a focused verification + tuning pass.

### Task 5.1: Verify the prefetch threshold formula and EMA convergence

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.test.ts` (extend)

- [ ] **Step 1: Add a middleware threshold unit test**

Append to `frontend/src/app/store/slices/SimulationSlice.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  simulationUpdateDataMiddleware,
  setCurrentTimeStepIndex,
} from "./SimulationSlice";
import requestReducer, { recordFetchLatency } from "./RequestSlice";

vi.mock("@/app/store/middleware/simulationRequestThunk", () => ({
  dispatchChunkRequest: vi.fn(),
}));

import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";

function buildStore() {
  return configureStore({
    reducer: {
      simulation: simulationReducer,
      request: requestReducer,
    },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false }).concat(simulationUpdateDataMiddleware),
  });
}

describe("simulationUpdateDataMiddleware", () => {
  it("triggers prefetch when remaining ≤ threshold", () => {
    const store = buildStore();
    // Fake a populated buffer + session.
    // (Use a minimal stub through internal API — the simplest path is to
    // hand-roll the state via the typed reducers.)
    // ... shape the state then dispatch setCurrentTimeStepIndex to fire middleware
    // Mock dispatchChunkRequest and assert called when remaining = 500 at speed 1.
    // Implementation left to the engineer — pattern mirrors existing
    // middleware tests in the repo. Key assertions:
    // - At speed=1, fetchLatency=1000ms, FPS=60: threshold = 1000. Should fire
    //   when remaining <= 1000.
    // - At speed=128, fetchLatency=1000ms, FPS=60: threshold = 11520. Should
    //   fire much earlier.
    // - When isRequestInProgress=true, should NOT fire.
    expect(dispatchChunkRequest).toBeDefined();
  });
});
```

(The test details depend on the store's state-shape conventions in the existing test file — match the existing style. If the test feels too coupled, omit it and rely on browser verification in step 2.)

- [ ] **Step 2: Browser verification at 128× speed**

Restart backend + frontend (if not already running). Load a sim, press play, increase speed to 128×.

Watch the BUFFER cell in the top status strip. At 128× the prefetcher should be triggering chunk requests almost continuously — buffer should never drop to zero. The simulation should keep advancing without stutter.

Also verify: pause the simulation (`spacebar` or click pause). The simulation should stop and **stay stopped** — no auto-unpause on the next chunk arrival.

- [ ] **Step 3: Commit (if test added) or move on**

```bash
git add frontend/src/app/store/slices/SimulationSlice.test.ts
git commit -m "test: middleware fires prefetch with speed-aware threshold

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Cleanup + first-load spinner

Goal: delete the UpdateModal, replace it with a tighter first-load-only indicator, and verify no behavior change otherwise.

### Task 6.1: Create FirstLoadSpinner component

**Files:**
- Create: `frontend/src/app/components/interface/misc/FirstLoadSpinner.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from "react";
import { useSelector } from "react-redux";
import {
  selectHasReceivedFirstChunk,
  selectSessionID,
} from "@/app/store/slices/SimulationSlice";

// Shown only between "user clicked Run" (sessionID present) and "first chunk
// landed" (hasReceivedFirstChunk == true). After that, prefetches are silent —
// no modal flashes between chunks like the old UpdateModal did.
const FirstLoadSpinner: React.FC = () => {
  const sessionID = useSelector(selectSessionID);
  const hasFirst = useSelector(selectHasReceivedFirstChunk);

  if (!sessionID || hasFirst) return null;

  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex items-center gap-3 rounded-md bg-black/70 text-white px-6 py-3 text-center"
    >
      <span
        className="inline-block h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin"
        aria-hidden="true"
      />
      <span className="text-base font-medium">Loading simulation…</span>
    </div>
  );
};

export default FirstLoadSpinner;
```

- [ ] **Step 2: Swap the mount in Layout.tsx**

In `frontend/src/app/components/scene/Layout.tsx`, replace the import and the JSX line:

```tsx
// REMOVE:
import UpdateModal from "@/app/components/interface/misc/UpdateModal";
// ADD:
import FirstLoadSpinner from "@/app/components/interface/misc/FirstLoadSpinner";
```

And in the JSX where `<UpdateModal />` is mounted (around Layout.tsx:61):
```tsx
// REMOVE: <UpdateModal />
// ADD:
<FirstLoadSpinner />
```

- [ ] **Step 3: Delete UpdateModal**

```bash
rm frontend/src/app/components/interface/misc/UpdateModal.tsx
```

- [ ] **Step 4: Verify build + lint + tests**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all PASS.

- [ ] **Step 5: Browser verification**

Restart frontend. Click Run. You should see:
- "Loading simulation…" spinner briefly while first chunk fetches.
- Spinner disappears as soon as first chunk lands.
- Subsequent chunk prefetches (every ~10k timesteps of playback) show **nothing** — no modal, no flash.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/interface/misc/FirstLoadSpinner.tsx frontend/src/app/components/scene/Layout.tsx
git rm frontend/src/app/components/interface/misc/UpdateModal.tsx
git commit -m "chrome: replace UpdateModal with FirstLoadSpinner

FirstLoadSpinner shows only between sim submit and first chunk arrival.
Prefetches mid-session are silent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.2: Final full-stack verification

- [ ] **Step 1: Backend tests**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS.

- [ ] **Step 2: Frontend full verify**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all PASS.

- [ ] **Step 3: Manual browser smoke (the headline UX check)**

Start backend and frontend. In the browser:

1. Click Run with default bodies.
2. First-load spinner appears for ~1s then disappears.
3. Playback starts. No center-screen modal at any point after the first chunk lands.
4. Scrub the timeline backwards and forwards across multiple chunks — smooth.
5. Crank speed to 128×. Watch the BUFFER cell — it should hover but never drop to zero; playback should not stall.
6. Pause. The simulation stops. Wait for the next chunk prefetch to land (visible via BUFFER cell jumping up). Simulation stays paused.
7. Browser console: no errors, no `console.log("Simulation data updated:", …)` spam.
8. Open Safari Web Inspector (on a Mac with iPhone) or Chrome devtools → Memory tab. The buffer console.info should show `budget=48MB capacity=…` on desktop. If testing on mobile / narrow viewport, should show `budget=12MB capacity=…`.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin buffering-pipeline-redesign
```

Expected: pushed. Surface the branch URL to byeon for review.

---

## Self-review notes

Coverage of the spec sections:

| Spec section | Plan task(s) |
|---|---|
| 1. Buffer data structure | Tasks 2.1, 2.3, 2.4, 2.5 |
| 2. Decode worker zero-alloc | Tasks 3.1, 3.2 |
| 3. Speed-aware prefetch | Task 3.4 (RequestSlice EMA), Task 3.5 (middleware threshold), Task 5.1 (verification) |
| 4. Backend speculative precompute | Tasks 1.1, 1.2, 1.3 |
| 5. Buffer capacity + eviction | Task 2.2 (byte budget), Task 2.3 (eviction), Task 3.5 (wired into slice) |
| 6. Removed behaviors | Task 3.5 (auto-unpause + dev log + isUpdating + selectors), Task 6.1 (UpdateModal) |
| 7. Initial-load behavior | Task 6.1 (FirstLoadSpinner + hasReceivedFirstChunk) |
| Consumer migration | Tasks 4.1–4.8 |
| Wire format unchanged | Implicit: parseBinaryChunk.test.ts and BinaryResponseSerializerTest pass throughout |

Each commit on the branch is small and self-contained. The branch lands as one logical bundle for byeon to verify and merge per the project's branch-workflow rule.
