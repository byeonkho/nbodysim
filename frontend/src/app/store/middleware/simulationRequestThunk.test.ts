import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  appendChunkToBuffer,
  loadSimulation,
  type SimulationParameters,
} from "@/app/store/slices/SimulationSlice";
import requestReducer from "@/app/store/slices/RequestSlice";
import SimConstants from "@/app/constants/SimConstants";
import type { AppDispatch } from "@/app/store/Store";
import {
  chunkRetryAttempts,
  dispatchChunkRequest,
  requestRunSimulation,
  resetChunkRetry,
} from "./simulationRequestThunk";

// The thunk decodes chunks through a module-singleton zstd Worker. Node has
// no Worker global; this fake captures each decode request and lets the test
// decide WHEN the canned payload comes back — the stale-session race lives
// in that window between fetch resolution and decode completion.
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  pending: number[] = [];

  postMessage(message: { id: number }) {
    this.pending.push(message.id);
    FakeWorker.last = this;
  }

  terminate() {}

  reply() {
    const id = this.pending.shift();
    if (id === undefined) throw new Error("no pending decode to reply to");
    this.onmessage?.({ data: { id, payload: cannedPayload() } });
  }
}

const TIMESTEPS = 4;

function cannedPayload() {
  return {
    messageType: "SIM_DATA",
    bodyNames: ["Sun"],
    bodyCount: 1,
    timestepCount: TIMESTEPS,
    positions: new Float64Array(TIMESTEPS * 6),
    timestamps: new Float64Array(TIMESTEPS),
    mu: { Sun: 1 },
    deltaERelative: new Float32Array(TIMESTEPS),
    dp853AvgStepSeconds: null,
    dp853AcceptRate: null,
  };
}

function sessionParams(sessionID: string): SimulationParameters {
  return {
    celestialBodyPropertiesList: [{ name: "Sun" }],
    simulationMetaData: { sessionID },
    lastRequest: null,
    showGrid: true,
    showAxes: false,
    showPlanetInfoOverlay: true,
    showTrails: true,
    showOrbitPaths: true,
    simulationScale: SimConstants.SCALE.LOG,
    cameraPreset: "top-down",
    displayFrame: "helio",
  };
}

function buildStore() {
  return configureStore({
    reducer: { simulation: simulationReducer, request: requestReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
}

describe("requestRunSimulation: stale-session guard", () => {
  beforeEach(() => {
    // drain leftovers so an earlier test's failure can't cascade
    FakeWorker.last?.pending.splice(0);
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8), // opaque; the fake worker never parses it
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops the chunk when the session changed while the decode was in flight", async () => {
    const store = buildStore();
    store.dispatch(loadSimulation(sessionParams("OLD")));

    const run = store.dispatch(requestRunSimulation({ sessionID: "OLD" }));

    // Wait for fetch + arrayBuffer to resolve and the decode request to
    // reach the worker.
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });

    // User resubmits: the slice's current session moves on, then the old
    // session's decode completes.
    store.dispatch(loadSimulation(sessionParams("NEW")));
    FakeWorker.last?.reply();
    await run;

    // Merging would splatter old-session timesteps into the new buffer;
    // the guard must drop the chunk silently instead.
    expect(store.getState().simulation.chunkBuffer).toBeNull();
    expect(store.getState().request.isRequestInProgress).toBe(false);
    expect(store.getState().request.errorMessage).toBeNull();
  });

  it("appends the chunk when the session is unchanged", async () => {
    const store = buildStore();
    store.dispatch(loadSimulation(sessionParams("LIVE")));

    const run = store.dispatch(requestRunSimulation({ sessionID: "LIVE" }));
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });
    FakeWorker.last?.reply();
    await run;

    const buffer = store.getState().simulation.chunkBuffer;
    expect(buffer).not.toBeNull();
    expect(buffer?.totalTimesteps).toBe(TIMESTEPS);
    expect(store.getState().request.isRequestInProgress).toBe(false);
    expect(store.getState().request.errorMessage).toBeNull();
  });
});

describe("requestRunSimulation: chunk index", () => {
  beforeEach(() => {
    FakeWorker.last?.pending.splice(0);
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the current chunksAppended as expectedChunkIndex", async () => {
    const store = buildStore();
    store.dispatch(loadSimulation(sessionParams("abc")));
    // Three successful appends -> chunksAppended = 3, the index the next
    // request must ask for.
    store.dispatch(appendChunkToBuffer(cannedPayload()));
    store.dispatch(appendChunkToBuffer(cannedPayload()));
    store.dispatch(appendChunkToBuffer(cannedPayload()));
    expect(store.getState().simulation.chunksAppended).toBe(3);

    let sentBody: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = store.dispatch(requestRunSimulation({ sessionID: "abc" }));
    // By the time the decode is pending, the fetch has been issued.
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });

    expect(sentBody).toMatchObject({ sessionID: "abc", expectedChunkIndex: 3 });

    // Complete the in-flight decode so the dispatch settles cleanly.
    FakeWorker.last?.reply();
    await run;
  });
});

// The supersede path is the stale-session guard's sibling: dispatchChunkRequest
// aborts the previous in-flight dispatch before issuing the next one. Both
// requests here share ONE session, so the stale-session guard above cannot
// catch the first request — only the abort keeps it from appending. The
// simple fetch stub above ignores the abort signal, which would let the
// superseded request run to completion; this block's stub parks each fetch
// under test control and rejects with AbortError when its signal fires,
// matching real fetch semantics.
describe("dispatchChunkRequest: supersede/abort", () => {
  let releaseFetches: Array<() => void>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeWorker.last?.pending.splice(0);
    releaseFetches = [];
    vi.stubGlobal("Worker", FakeWorker);
    fetchMock = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          const abort = () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          };
          if (init?.signal?.aborted) {
            abort();
            return;
          }
          init?.signal?.addEventListener("abort", abort);
          releaseFetches.push(() =>
            resolve({
              ok: true,
              status: 200,
              headers: { get: () => null },
              arrayBuffer: async () => new ArrayBuffer(8),
            }),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the first request when a second supersedes it, and the second proceeds", async () => {
    const store = buildStore();
    store.dispatch(loadSimulation(sessionParams("LIVE")));
    // Same cast the prefetch middleware uses at its dispatchChunkRequest call site.
    const dispatch = store.dispatch as AppDispatch;

    const first = dispatchChunkRequest(dispatch, { sessionID: "LIVE" });
    await vi.waitFor(() => {
      expect(releaseFetches.length).toBe(1);
    });

    // Supersede while the first request's fetch is still in flight.
    const second = dispatchChunkRequest(dispatch, { sessionID: "LIVE" });

    // The first settles as aborted with the supersede reason, silently:
    // no chunk appended, no user-facing error.
    const firstAction = (await first) as {
      meta: { requestStatus: string; aborted: boolean };
      error?: { name?: string; message?: string };
    };
    expect(firstAction.meta.requestStatus).toBe("rejected");
    expect(firstAction.meta.aborted).toBe(true);
    expect(firstAction.error?.message).toBe("superseded");
    expect(store.getState().simulation.chunkBuffer).toBeNull();
    expect(store.getState().request.errorMessage).toBeNull();

    // The superseder set isRequestInProgress(true) synchronously at
    // dispatch; the aborted request's cleanup runs a microtask later and
    // must NOT knock the flag back to false while the second request is
    // still in flight: the prefetch gate keys on this flag, and a false
    // reading mid-flight lets it dispatch duplicate chunk requests. The
    // macrotask flush guarantees the aborted catch has run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().request.isRequestInProgress).toBe(true);

    // The second proceeds normally: release its fetch, complete its decode.
    await vi.waitFor(() => {
      expect(releaseFetches.length).toBe(2);
    });
    releaseFetches[1]();
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });
    FakeWorker.last?.reply();
    await second;

    // Exactly one chunk landed (the second's): the aborted request neither
    // double-fetched nor appended late.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().simulation.chunkBuffer?.totalTimesteps).toBe(
      TIMESTEPS,
    );
    expect(store.getState().request.errorMessage).toBeNull();
    expect(store.getState().request.isRequestInProgress).toBe(false);
  });

  it("drops a request superseded while its chunk was decoding", async () => {
    const store = buildStore();
    store.dispatch(loadSimulation(sessionParams("LIVE")));
    const dispatch = store.dispatch as AppDispatch;

    const first = dispatchChunkRequest(dispatch, { sessionID: "LIVE" });
    await vi.waitFor(() => {
      expect(releaseFetches.length).toBe(1);
    });
    releaseFetches[0]();
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });

    // Supersede after the fetch resolved, while the decode is in flight.
    // The abort can no longer reject the fetch, and both requests share a
    // session, so neither the AbortError catch nor the stale-session guard
    // stands between the doomed request and a late append.
    const second = dispatchChunkRequest(dispatch, { sessionID: "LIVE" });
    FakeWorker.last?.reply();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The doomed request's decode completed, but it must drop its chunk
    // and leave the in-progress flag (owned by the superseder) alone.
    expect(store.getState().simulation.chunkBuffer).toBeNull();
    expect(store.getState().request.isRequestInProgress).toBe(true);
    expect(store.getState().request.errorMessage).toBeNull();

    // The second still lands its chunk normally.
    await vi.waitFor(() => {
      expect(releaseFetches.length).toBe(2);
    });
    releaseFetches[1]();
    await vi.waitFor(() => {
      expect(FakeWorker.last?.pending.length).toBe(1);
    });
    FakeWorker.last?.reply();
    await second;

    expect(store.getState().simulation.chunkBuffer?.totalTimesteps).toBe(
      TIMESTEPS,
    );
    expect(store.getState().request.errorMessage).toBeNull();
    expect(store.getState().request.isRequestInProgress).toBe(false);
  });
});

// 410 (session gone) and 409 (cursor conflict) are terminal: retrying recovers
// neither, so the thunk clears the session and prompts a fresh run. 429/5xx and
// network errors are transient: the thunk arms an exponential backoff timer
// (keeping isRequestInProgress true so the prefetch middleware doesn't also
// re-fire), and the timer drives the retry independent of playback dispatches.
describe("requestRunSimulation: terminal + backoff handling", () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    store = buildStore();
    store.dispatch(loadSimulation(sessionParams("abc")));
  });

  afterEach(() => {
    // Module-level retry state leaks across tests unless reset.
    vi.useRealTimers();
    resetChunkRetry();
    vi.unstubAllGlobals();
  });

  it("expires the session and shows a run-again message on 410", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 410,
        ok: false,
        headers: new Headers(),
      }),
    );

    await store.dispatch(requestRunSimulation({ sessionID: "abc" }));

    expect(
      store.getState().simulation.simulationParameters.simulationMetaData,
    ).toBeNull();
    expect(store.getState().request.errorMessage).toMatch(/run/i);
    expect(store.getState().request.isRequestInProgress).toBe(false);
    expect(chunkRetryAttempts()).toBe(0);
  });

  it("drops a 410 for a stale session without clearing the current one", async () => {
    // A retry timer for an OLD session lands a 410 after the user started a new
    // run: the slice's current session is "abc", but this response is for "OLD".
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 410,
        ok: false,
        headers: new Headers(),
      }),
    );

    await store.dispatch(requestRunSimulation({ sessionID: "OLD" }));

    // The current session survives: the stale 410 was dropped silently.
    expect(
      store.getState().simulation.simulationParameters.simulationMetaData
        ?.sessionID,
    ).toBe("abc");
    expect(store.getState().request.errorMessage).toBeNull();
    expect(store.getState().request.isRequestInProgress).toBe(false);
  });

  it("schedules a backoff retry on a 503 instead of erroring", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await store.dispatch(requestRunSimulation({ sessionID: "abc" }));

    // No terminal error; the loop stays "occupied" so the middleware won't re-fire.
    expect(store.getState().request.isRequestInProgress).toBe(true);
    expect(chunkRetryAttempts()).toBe(1);

    // The timer drives the retry, not a playback dispatch.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with a terminal toast after the attempt budget is spent", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      headers: new Headers(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await store.dispatch(requestRunSimulation({ sessionID: "abc" }));

    // Drive the backoff to exhaustion: each fire schedules the next, growing
    // 1s, 2s, 4s, 8s, 16s. Run the clock well past the cap to flush them all.
    for (let i = 0; i < 8; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }

    expect(store.getState().request.errorMessage).toMatch(/run/i);
    expect(store.getState().request.isRequestInProgress).toBe(false);
    expect(chunkRetryAttempts()).toBe(0);
  });
});
