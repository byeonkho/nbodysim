import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  appendChunkToBuffer,
  setActiveBody,
  setCurrentTimeStepIndex,
  setLastSimRequest,
} from "@/app/store/slices/SimulationSlice";
import groundTruthReducer, {
  setOverlayEnabled,
} from "@/app/store/slices/GroundTruthSlice";
import {
  groundTruthMiddleware,
  resetGroundTruthMiddlewareState,
} from "./groundTruthMiddleware";

// Pin the trail length so the fetch window is deterministic and the dev
// settings store never touches browser APIs in the node test env.
vi.mock("@/app/dev/devSettingsStore", () => ({
  getDevSettings: () => ({ trailLength: 1500 }),
}));

// Harness: real slices + the real middleware, network stubbed. The chunk
// payload builds a 1-body buffer with hourly keyframes so coverage windows
// are deterministic: timestamps[i] = T0 + i * HOUR_MS.
const HOUR_MS = 3_600_000;
const T0 = 1_750_000_000_000;
const N = 9_000; // keyframes in the buffer (> LOOKAHEAD_KEYFRAMES = 4000)

function chunkPayload(n: number, startMs: number) {
  const timestamps = new BigInt64Array(n);
  for (let i = 0; i < n; i++) timestamps[i] = BigInt(startMs + i * HOUR_MS);
  return {
    bodyNames: ["Mars"],
    bodyCount: 1,
    timestepCount: n,
    positions: new Float64Array(n * 6),
    timestamps,
    mu: { Mars: 4.2828e13 },
    deltaERelative: new Float32Array(n),
    dp853AvgStepSeconds: null as number | null,
    dp853AcceptRate: null as number | null,
  };
}

const lastReq = {
  celestialBodyNames: ["Mars"],
  date: "2025-06-05T00:00:00.000Z",
  frame: "Heliocentric",
  integrator: "rk4",
  timeStepUnit: "hours",
};

function makeStore() {
  return configureStore({
    reducer: { simulation: simulationReducer, groundTruth: groundTruthReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }).concat(
        groundTruthMiddleware,
      ),
  });
}

// The thunk resolves over two awaits (fetch, json) plus a .finally; a
// macrotask flush settles all of it.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("groundTruthMiddleware: playback-driven coverage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let nowMs: number;

  beforeEach(() => {
    resetGroundTruthMiddlewareState();
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tracks: [] }), // empty anchors still record coverage
    }));
    vi.stubGlobal("fetch", fetchMock);
    nowMs = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Builds the standard scene: buffer present, overlay on, Mars focused at
  // playback index `idx`. The setActiveBody dispatch fires the initial
  // immediate fetch, which we settle before returning.
  async function setupCoveredAt(store: ReturnType<typeof makeStore>, idx: number) {
    store.dispatch(setLastSimRequest(lastReq));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(idx));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it("refetches when playback outruns coverage (the clip-freeze fix)", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0); // coverage ends at timestamps[0 + 4000]

    store.dispatch(setCurrentTimeStepIndex(4_500));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // New coverage extends ahead of the new head.
    const { coveredToMs } = store.getState().groundTruth;
    expect(coveredToMs).toBe(T0 + Math.min(N - 1, 4_500 + 4_000) * HOUR_MS);
  });

  it("rate-limits playback-driven attempts to one per 3 seconds", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0);

    store.dispatch(setCurrentTimeStepIndex(4_500));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Still exhausted (coverage now ends at 8500; ask past it), but inside
    // the throttle window: no new attempt.
    store.dispatch(setCurrentTimeStepIndex(5_000));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Past the throttle window: fires.
    nowMs += 3_001;
    store.dispatch(setCurrentTimeStepIndex(5_000));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops fetching once coverage reaches the buffer end", async () => {
    const store = makeStore();
    // Focus with the head deep enough that the initial fetch already covers
    // through the final keyframe (idx + 4000 clamps at N-1).
    await setupCoveredAt(store, 5_000);

    nowMs += 10_000;
    store.dispatch(setCurrentTimeStepIndex(6_000));
    await flush();
    store.dispatch(setCurrentTimeStepIndex(8_999));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial fetch
  });

  it("never fetches from index dispatches while the overlay is off", async () => {
    const store = makeStore();
    store.dispatch(setLastSimRequest(lastReq));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setActiveBody("Mars")); // overlay off: no immediate fetch
    await flush();

    store.dispatch(setCurrentTimeStepIndex(4_500));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("requests subtractSun=false when the session has no Sun", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0); // lastReq bodies are ["Mars"], no Sun
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("subtractSun=false");
  });

  it("requests subtractSun=true when the session includes the Sun", async () => {
    const store = makeStore();
    store.dispatch(setLastSimRequest({ ...lastReq, celestialBodyNames: ["Sun", "Mars"] }));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(0));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars"));
    await flush();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("subtractSun=true");
  });
});
