# Data buffering pipeline redesign

**Status:** design, awaiting user review
**Branch:** `buffering-pipeline-redesign`
**Date:** 2026-05-14

## Goals

Make chunk transitions imperceptible at any playback speed, eliminate the "Fetching data…" modal, and let the buffer scale large enough that scrubbing backwards across normal playback distances never hits a gap.

Three concrete user-visible outcomes:

1. The forced auto-unpause + center-screen modal at every chunk arrival is gone.
2. Playback at `speedMultiplier = 128` does not stall waiting for the next chunk.
3. The buffer can comfortably hold ~100k timesteps (~28 min of 1× playback, or ~13 s of 128× playback) without per-frame cost scaling with size.

Non-goal: support scrubbing backwards beyond the current resident buffer. That needs re-fetch-by-index, which the backend doesn't support today; flagged in [Future work](#future-work).

## Current state — the three pain points

Documented in detail in chat. Summary for spec-readers:

- **Pain 1 — jarring first→second transition.** Prefetch trigger is speed-blind (constant 9000-step threshold). At high speed multipliers the buffer empties before the fetch lands; on arrival the reducer force-sets `isPaused = false`, which feels like a state jump.
- **Pain 2 — "Fetching data" overlay.** Modal flashes every prefetch. Plus a real main-thread hitch from `simulationData = {...old, ...new}` on a 30k-entry object.
- **Pain 3 — buffer ceiling.** Per-frame cost (`selectCurrentTimeStepKey` → `Object.keys()` on date-keyed object) scales with buffer size, capping practical buffer around 30k.

## Architecture overview

```
                          BACKEND (Spring Boot)
                          ┌──────────────────────────────────────────┐
   POST /chunk            │  Simulation cache:                       │
   ─────────────────────► │    nextChunk: byte[] | computing | null  │
                          │                                          │
                          │  On request:                             │
                          │    if cache=ready: return cache, kick    │
                          │      off next compute in background      │
                          │    if cache=computing: await + return    │
                          │    if cache=null: compute sync + return  │
                          │      + kick off next                     │
                          └────────────────┬─────────────────────────┘
                                           │ zstd binary (~4 MB)
                                           ▼
                          FRONTEND (Next.js / R3F)
                          ┌──────────────────────────────────────────┐
                          │ zstdWorker.ts:                           │
                          │   decompress → typed-array fill          │
                          │   (positions: Float64Array, timestamps:  │
                          │    BigInt64Array) — no JS objects        │
                          │                                          │
                          │ ChunkBuffer (in Redux state):            │
                          │   positions: Float64Array  (preallocd)   │
                          │   timestamps: BigInt64Array (preallocd)  │
                          │   bodyNames: string[]                    │
                          │   bodyCount: number                      │
                          │   totalTimesteps: number  (write cursor) │
                          │                                          │
                          │ AnimationController.useFrame:            │
                          │   idx O(1) lookup, no Object.keys        │
                          │                                          │
                          │ Speed-aware prefetch middleware:         │
                          │   threshold = f(speedMultiplier,         │
                          │                  fetch_latency_ema)      │
                          └──────────────────────────────────────────┘
```

## Component changes

### 1. Buffer data structure — typed-array-backed

Replace `simulationData: { [iso: string]: CelestialBody[] } | null` with:

```ts
interface ChunkBuffer {
  // Preallocated to BUFFER_CAPACITY × bodyCount × 6.
  // Layout: positions[idx*bodyCount*6 + body*6 + component]
  // components: [px, py, pz, vx, vy, vz]
  positions: Float64Array;
  // Preallocated to BUFFER_CAPACITY.
  timestamps: BigInt64Array;
  // Constant per session.
  bodyNames: readonly string[];
  bodyNameToIndex: ReadonlyMap<string, number>;
  bodyCount: number;
  // Write cursor: number of valid timesteps. Lives separately from
  // currentTimeStepIndex (which is the playback head).
  totalTimesteps: number;
  // Tracks where the kept-buffer-window starts in the session's global
  // timestep numbering. When deleteExcessData drops the oldest 10k,
  // bufferStartTimestep advances by 10k. Used to translate between
  // (idx-into-buffer) and (idx-since-sim-start) — the latter is what
  // the UI scrubber should display.
  bufferStartTimestep: number;
}
```

**Why this layout:**
- O(1) timestep lookup by index. Kills the per-frame `Object.keys()` cost permanently.
- Mirrors the backend's `currentStateBuffer` layout — the wire format already ships positions in this exact order, so the decode worker can `memcpy` directly into the typed array slot, skipping per-body JS object allocation entirely.
- Memory: 100k × 9 × 6 × 8 = 43 MB for positions + 800 KB for timestamps. Acceptable on desktop; mobile is out of scope for this round.
- `bodyNameToIndex` map removes the `snapshot.find(b => b.name === bodyName)` linear scan that every consumer does today.

**Helper accessors** (lifted out of consumer components into a small `bufferAccess.ts` module):

```ts
// Read into a caller-provided THREE.Vector3 to avoid per-frame allocation.
function readBodyPositionInto(
  out: THREE.Vector3, buffer: ChunkBuffer, timestepIdx: number, bodyIdx: number,
): void

// Same shape for velocity. Same shape for both at once (single base-offset calc).
function readBodyStateInto(
  outPos: THREE.Vector3, outVel: THREE.Vector3,
  buffer: ChunkBuffer, timestepIdx: number, bodyIdx: number,
): void

function getTimestamp(buffer: ChunkBuffer, timestepIdx: number): bigint
function getTimestampAsIsoString(buffer: ChunkBuffer, timestepIdx: number): string
```

### 2. Decode worker — zero-allocation path

`zstdWorker.ts` + `parseBinaryChunk.ts` currently decompress → allocate one JS object per (body, timestep) → return a `Record<string, CelestialBody[]>`. After change:

- Worker decompresses, then writes directly into a `Float64Array` and `BigInt64Array` it allocates per chunk (or reuses across chunks via a free-list).
- Transferable: post the typed arrays back to the main thread via `postMessage(payload, [positions.buffer, timestamps.buffer])`. Zero copy.
- Main thread receives them, copies the relevant slot range into the resident `ChunkBuffer` at `[totalTimesteps, totalTimesteps + chunkLen)`.

**Wire format is unchanged.** Only the decode path changes. The existing cross-language wire-format tests (`BinaryResponseSerializerTest`, `parseBinaryChunk.test.ts`) continue to pin the binary layout; we add a new test for the typed-array decode path that consumes the same fixture bytes.

### 3. Speed-aware prefetch trigger

Replace the constant `<= 9000` threshold with:

```ts
// State kept in Redux (RequestSlice): rolling EMA of recent fetch latencies.
fetchLatencyEmaMs: number  // default 1000ms before any measurement lands

// Trigger formula:
const MIN_THRESHOLD = 1000;
const SAFETY_FACTOR = 1.5;
const stepsConsumedPerSecond = FPS * Math.abs(speedMultiplier);
const stepsConsumedDuringFetch =
  stepsConsumedPerSecond * (fetchLatencyEmaMs / 1000);
const threshold = Math.max(
  MIN_THRESHOLD,
  Math.ceil(stepsConsumedDuringFetch * SAFETY_FACTOR),
);

if (remaining <= threshold && !isRequestInProgress) {
  dispatchChunkRequest(...);
}
```

Worked examples (with `fetchLatencyEmaMs = 1000`, FPS = 60, safety = 1.5):

| speedMultiplier | stepsConsumedDuringFetch | threshold | trigger fires when remaining ≤ |
|---|---|---|---|
| 1   | 60     | 1000  | 1000 |
| 8   | 480    | 1000  | 1000 |
| 32  | 1920   | 2880  | 2880 |
| 64  | 3840   | 5760  | 5760 |
| 128 | 7680   | 11520 | 11520 |

At 128× we trigger immediately on chunk landing — which is correct, the next fetch needs to be in flight at all times to keep up.

**Rolling EMA update** lives in the thunk: after each successful fetch, measure wall time from `dispatch(setRequestInProgress(true))` to `dispatch(updateDataReceived(...))` and dispatch `recordFetchLatency(ms)`. Slice does `ema = 0.7 * ema + 0.3 * latest` (5-sample-ish memory).

### 4. Backend — speculative precompute

Add per-session state to `SimulationSessionService`:

```java
// Per-session prefetched chunk. null = nothing cached; the Future is
// the in-flight compute if any; the byte[] is the ready zstd payload.
private final ConcurrentHashMap<String, CompletableFuture<byte[]>> nextChunkCache;
```

Behavior in `SimulationController.getNextChunk`:

1. If `nextChunkCache.get(sessionID)` is present and done → take it, return it.
2. If it's present and in-flight → `await` it (client is waiting on this fetch anyway).
3. If absent → compute synchronously, return.
4. **In all three cases:** after the response body is written, submit a new `CompletableFuture<byte[]>` to a session-scoped executor that runs the next 10k-step compute + serialize + compress, and put it in `nextChunkCache`.

The future completes off-request-thread; no need to hold the HTTP thread. The simulation's `currentStateBuffer` is the state machine that advances — speculative compute mutates it, but since chunks are strictly sequential and never re-served, that's correct.

**Eviction:** the per-session idle sweeper (15 min) clears the cache entry alongside the simulation map entry.

**Memory cost:** one buffered chunk per active session × ~4 MB compressed = ~4 MB/session. Fine.

**Concurrency safety:** sessions are independent; `Simulation` is single-threaded per session by construction (only one `/chunk` request per session at a time, enforced by client `dispatchChunkRequest` aborting in-flight before issuing new). Backend doesn't need locks beyond the `ConcurrentHashMap`.

**Why not SSE / HTTP/2 push:** SSE adds a long-lived connection per session + reconnect logic + chunked-stream parsing on the client. HTTP/2 push is browser-deprecated. Speculative precompute is the simplest path to overlapping compute with consumption, and it doesn't change the API surface.

### 5. Buffer capacity + eviction

```ts
const BUFFER_CAPACITY = 100_000;  // up from MAX_TIMESTEPS = 30_000
const CHUNK_SIZE = 10_000;        // unchanged
```

When `totalTimesteps + CHUNK_SIZE > BUFFER_CAPACITY` on chunk arrival:

- Shift the typed arrays left by `CHUNK_SIZE` slots (typed-array `copyWithin` is fast).
- Advance `bufferStartTimestep` by `CHUNK_SIZE`.
- Adjust `currentTimeStepIndex` by `-CHUNK_SIZE` (matches today's `deleteExcessData` behavior).
- `totalTimesteps -= CHUNK_SIZE`, then append the new chunk.

`copyWithin` on a 540k-element `Float64Array` (100k × 9 × 6) is ~5 ms uncached; ~1–2 ms hot. One-time cost on chunk arrival, post-eviction-threshold. Acceptable.

Alternative considered: ring buffer with a moving `writeStart` index. Saves the shift but every consumer has to do modular arithmetic on reads. Not worth the complexity here; revisit if eviction cost shows up in profiles.

### 6. Removed behaviors

- **Forced auto-unpause on chunk arrival** ([SimulationSlice.ts:291](frontend/src/app/store/slices/SimulationSlice.ts:291)) — delete. `isPaused` becomes user-controlled only.
- **`UpdateModal`** ([UpdateModal.tsx](frontend/src/app/components/interface/misc/UpdateModal.tsx)) — delete component, drop the `<UpdateModal />` mount.
- **`console.log("Simulation data updated:", state.simulationData)`** ([SimulationSlice.ts:257](frontend/src/app/store/slices/SimulationSlice.ts:257)) — delete.
- **Redundant `isUpdating` flag** ([SimulationSlice.ts:17](frontend/src/app/store/slices/SimulationSlice.ts:17)) — fold into `isRequestInProgress` on RequestSlice. One source of truth.
- **`selectSimulationDataSize`** ([SimulationSlice.ts:542](frontend/src/app/store/slices/SimulationSlice.ts:542)) — DevPanel-only consumer. Replace with a cheap calculation: `bodyCount × 6 × 8 × totalTimesteps` bytes.

### 7. Initial-load behavior

First chunk fetch still happens synchronously when the user clicks Run. While the first chunk is computing, the scene shows whatever it currently shows (likely empty / placeholder). **One** exception to the "no modal" rule: keep a centered spinner or progress indicator for the *first* chunk only, since the scene is genuinely blank at that point and silence would look broken.

Mechanism: a slice flag `hasReceivedFirstChunk: boolean` (defaults false, set true in `updateDataReceived` on first arrival), drives the first-load indicator. Subsequent prefetches show nothing.

## Consumer migration

Components that read `simulationData` today and need to switch to typed-array accessors:

- `AnimationController.tsx` — uses `selectTimeStepKeys.length` and indexing. Becomes `buffer.totalTimesteps`.
- `Sphere.tsx`, `Reticle.tsx`, `GhostLabel.tsx`, `Camera.tsx` — read body position per frame. Switch to `readBodyPositionInto(scratchVec, buffer, idx, bodyIdx)`.
- `Trail.tsx` — iterates history of timesteps backwards. Switch to indexed loop over `[idx-trailLen, idx]` slot range, reading positions directly.
- `OrbitPath.tsx` — similar to Trail. Indexed loop.
- `TopStatusStrip.tsx`, `Timeline.tsx` — display UTC + JD from current timestep. Use `getTimestampAsIsoString(buffer, idx)`.
- `BodyCard.tsx` — reads current and prior state for orbital element computation. Use the accessor helpers.

The slice's selectors (`selectCurrentTimeStepKey`, `selectTimeStepKeys`) get removed or replaced by accessors. The render-loop-rules pattern of `useStore` + `store.getState()` inside `useFrame` is preserved everywhere.

## Sequencing for implementation

Implementation plan will be drafted via the writing-plans skill. High-level phases (each phase = one commit on this branch, byeon-verified before next):

1. **Backend speculative precompute** — additive, no client changes needed. Test by hitting `/chunk` twice in a row and measuring response time of the second call.
2. **Typed-array buffer + zero-alloc decode worker** — biggest change. Touches the slice, the worker, and every render-loop consumer. Wire-format tests still pass; new accessor tests added.
3. **Speed-aware prefetch + EMA** — small slice + middleware change. Test by playing at 128× and confirming no stalls.
4. **Remove UpdateModal + auto-unpause + dev logs + redundant flags** — pure deletion + a first-load spinner.
5. **Bump BUFFER_CAPACITY to 100k** — one constant change, but verify memory + that eviction shift works.

Phases 2 and 4 together are the headline UX win. Phase 1 is the throughput win. Phase 3 is the high-speed correctness win. Phase 5 unlocks future scrubbing range.

## Testing & verification

Per project rules:

- **Wire format pinning** — existing `BinaryResponseSerializerTest` (Java) + `parseBinaryChunk.test.ts` (TS) continue to pass against the unchanged binary layout. Add a typed-array decode test consuming the same fixture bytes.
- **Buffer math** — unit-test the eviction-shift in the slice: append until eviction, assert `bufferStartTimestep` advances, `totalTimesteps` resets, `currentTimeStepIndex` shifts.
- **Speed-aware threshold formula** — unit-test the trigger condition at speedMultiplier ∈ {1, 8, 32, 128} with mocked EMA.
- **Backend precompute** — integration test: call `/chunk` twice with a real Spring context, assert the second call returns in << first-call latency.
- **Browser verification** — exercise the playback flow at 1× and 128×, scrub backwards across multiple chunks, confirm no modal flashes, no console errors, FPS stable. Per project rules, this is required before claiming done.

## Open questions / decisions made

- **Why Float64 not Float32 for positions?** Wire format already ships Float64. Switching to Float32 is todo #37's question and is orthogonal to this redesign — same buffer layout, just half the byte width. Defer to that task.
- **Why not interpolate between chunks (todo #20)?** Catmull-Rom interpolation is a separate axis (reducing wire payload by sending every Nth keyframe). Compatible with this design but separately scoped.
- **Why one cached chunk per session, not N?** N>1 adds queue-management complexity for marginal gain — at 128× speed, even one chunk ahead clears the stall, and the EMA-driven threshold ensures we always have a request in flight. Reconsider if profiling shows the precompute is still on the critical path.

## Future work

- **Re-fetch dropped chunks** for true unbounded backwards scrubbing. Needs backend support for `(sessionID, startTimestep, count)` chunk requests, which means the integrator's `currentStateBuffer` either needs to be replayable from snapshots or the backend needs to keep per-chunk start-states. Heavier change; flag separately if scrubbing-back-past-buffer becomes a real ask.
- **Mobile / memory-constrained**: 43 MB resident is fine on desktop; mobile might want a smaller cap. Tie to redesign Phase 8 (todo #35).
- **Multi-chunk look-ahead** on the server (cache N>1) — only if profiling shows precompute still bottlenecks.
