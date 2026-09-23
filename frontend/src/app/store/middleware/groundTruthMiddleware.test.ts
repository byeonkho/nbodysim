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
import requestReducer from "@/app/store/slices/RequestSlice";
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
  const timestamps = new Float64Array(n);
  for (let i = 0; i < n; i++) timestamps[i] = startMs + i * HOUR_MS;
  return {
    bodyNames: ["Mars"],
    bodyCount: 1,
    timestepCount: n,
    positions: new Float64Array(n * 6),
    timestamps,
    referenceEpochs: timestamps,
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
    reducer: {
      simulation: simulationReducer,
      groundTruth: groundTruthReducer,
      request: requestReducer,
    },
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
    resetGroundTruthMiddlewareState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Builds the standard scene: buffer present, overlay on, Mars focused at
  // playback index `idx`. The setActiveBody dispatch fires the initial
  // immediate fetch, which we settle before returning.
  async function setupCoveredAt(
    store: ReturnType<typeof makeStore>,
    idx: number,
  ) {
    store.dispatch(setLastSimRequest(lastReq));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(idx));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it("refreshes the final paused seek after an in-flight request and throttle", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0);
    expect(store.getState().simulation.timeState.isPaused).toBe(true);
    vi.useFakeTimers();
    store.dispatch(setCurrentTimeStepIndex(4500));
    store.dispatch(setCurrentTimeStepIndex(0));
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    nowMs += 3001;
    await vi.advanceTimersByTimeAsync(3001);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.getState().groundTruth.coveredByBody.MARS.fromMs).toBe(T0);
  });

  it("cancels a pending paused refresh on a new launch", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0);
    vi.useFakeTimers();
    store.dispatch(setCurrentTimeStepIndex(4500));
    store.dispatch(setCurrentTimeStepIndex(0));
    await vi.advanceTimersByTimeAsync(1);
    store.dispatch(setLastSimRequest(lastReq));
    nowMs += 3001;
    await vi.advanceTimersByTimeAsync(3001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after rewinding outside the reference window", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 7000);
    store.dispatch(setCurrentTimeStepIndex(0));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().groundTruth.coveredByBody.MARS.fromMs).toBe(T0);
  });

  it("retries a failed initial fetch on playback even without coverage", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    const store = makeStore();
    await setupCoveredAt(store, 0);
    store.dispatch(setCurrentTimeStepIndex(1));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when playback outruns coverage (the clip-freeze fix)", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0); // coverage ends at timestamps[0 + 4000]

    store.dispatch(setCurrentTimeStepIndex(4_500));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // New coverage extends ahead of the new head (tracked under the active body).
    const { coveredByBody } = store.getState().groundTruth;
    expect(coveredByBody["MARS"].toMs).toBe(
      T0 + Math.min(N - 1, 4_500 + 1_000) * HOUR_MS,
    );
  });

  it("rate-limits playback-driven attempts to one per 3 seconds", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0);

    store.dispatch(setCurrentTimeStepIndex(4_500));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Still exhausted (coverage now ends at 8500; ask past it), but inside
    // the throttle window: no new attempt.
    store.dispatch(setCurrentTimeStepIndex(5_500));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Past the throttle window: fires.
    nowMs += 3_001;
    store.dispatch(setCurrentTimeStepIndex(5_500));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops fetching once coverage reaches the buffer end", async () => {
    const store = makeStore();
    // Focus with the head deep enough that the initial fetch already covers
    // through the final keyframe (idx + 4000 clamps at N-1).
    await setupCoveredAt(store, 8_000);

    nowMs += 10_000;
    store.dispatch(setCurrentTimeStepIndex(8_500));
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
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).subtractSun).toBe(false);
  });

  it("requests subtractSun=true when the session includes the Sun", async () => {
    const store = makeStore();
    store.dispatch(
      setLastSimRequest({ ...lastReq, celestialBodyNames: ["Sun", "Mars"] }),
    );
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(0));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars"));
    await flush();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).subtractSun).toBe(true);
  });

  // The loading notice reads userFetchInFlight, so it must be true only while a
  // user-initiated fetch is pending and false for the background top-ups.
  it("flags userFetchInFlight only while a user-initiated fetch is pending", async () => {
    const store = makeStore();
    store.dispatch(setLastSimRequest(lastReq));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(0));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars")); // user-initiated immediate fetch
    // The thunk's pending action fires synchronously during dispatch.
    expect(store.getState().groundTruth.userFetchInFlight).toBe(true);
    await flush();
    expect(store.getState().groundTruth.userFetchInFlight).toBe(false);
  });

  it("never flags userFetchInFlight for a background top-up refetch", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0);
    expect(store.getState().groundTruth.userFetchInFlight).toBe(false);

    store.dispatch(setCurrentTimeStepIndex(4_500)); // playback-driven background fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The chip's busy flag still toggles, but the notice flag never lifts, so
    // the notice cannot blink on these.
    expect(store.getState().groundTruth.fetchInFlight).toBe(true);
    expect(store.getState().groundTruth.userFetchInFlight).toBe(false);
    await flush();
    expect(store.getState().groundTruth.userFetchInFlight).toBe(false);
  });

  it("surfaces an error toast when a user-initiated fetch fails", async () => {
    const store = makeStore();
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    store.dispatch(setLastSimRequest(lastReq));
    store.dispatch(appendChunkToBuffer(chunkPayload(N, T0)));
    store.dispatch(setCurrentTimeStepIndex(0));
    store.dispatch(setOverlayEnabled(true));
    store.dispatch(setActiveBody("Mars")); // user-initiated -> failure is surfaced
    await flush();
    expect(store.getState().request.errorMessage).toMatch(
      /real-world positions/i,
    );
  });

  it("stays silent when a background refetch fails", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0); // initial user fetch succeeds
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    store.dispatch(setCurrentTimeStepIndex(4_500)); // background refetch -> fails quietly
    await flush();
    expect(store.getState().request.errorMessage).toBeNull();
  });

  // Coverage is tracked per body, so flipping to another body and back does not
  // re-pull a body whose window is still covered (a single covered-window record
  // would have forgotten the first body and refetched it).
  it("does not refetch a body whose window is still covered after visiting another", async () => {
    const store = makeStore();
    await setupCoveredAt(store, 0); // Mars fetched + covered at idx 0
    expect(fetchMock).toHaveBeenCalledTimes(1);

    store.dispatch(setActiveBody("Earth")); // different body: its own fetch
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    store.dispatch(setActiveBody("Mars")); // back to Mars, same window: still covered
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2); // no redundant refetch
  });
});
