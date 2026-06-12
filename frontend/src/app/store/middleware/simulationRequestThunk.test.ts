import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  loadSimulation,
  type SimulationParameters,
} from "@/app/store/slices/SimulationSlice";
import requestReducer from "@/app/store/slices/RequestSlice";
import SimConstants from "@/app/constants/SimConstants";
import { requestRunSimulation } from "./simulationRequestThunk";

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
    timestamps: new BigInt64Array(TIMESTEPS),
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
