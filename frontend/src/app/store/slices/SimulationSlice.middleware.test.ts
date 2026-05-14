import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  simulationUpdateDataMiddleware,
  setCurrentTimeStepIndex,
  loadSimulation,
  appendChunkToBuffer,
  setSpeedMultiplier,
  type SimulationParameters,
} from "./SimulationSlice";
import requestReducer, {
  recordFetchLatency,
  setRequestInProgress,
} from "./RequestSlice";
import SimConstants from "@/app/constants/SimConstants";

// Mock the request thunk so the middleware's dispatchChunkRequest becomes
// an observable spy. The middleware imports dispatchChunkRequest from the
// real module at load time, so the mock has to be hoisted (vi.mock is).
vi.mock("@/app/store/middleware/simulationRequestThunk", () => ({
  dispatchChunkRequest: vi.fn(),
}));

import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";

// Middleware threshold contract (matches the slice's formula):
//
//   threshold = max(1000, ceil(speedMultiplier * FPS * fetchLatencyMs/1000 * 1.5))
//
// Prefetch fires when `remaining <= threshold && !isRequestInProgress`.
// Tests pin the formula at the boundary conditions for each playback regime.

function buildStore() {
  return configureStore({
    reducer: {
      simulation: simulationReducer,
      request: requestReducer,
    },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false }).concat(
        simulationUpdateDataMiddleware,
      ),
  });
}

function seedSession(
  store: ReturnType<typeof buildStore>,
  totalTimesteps: number,
) {
  const params: SimulationParameters = {
    celestialBodyPropertiesList: [{ name: "Sun" }],
    simulationMetaData: { sessionID: "TEST_SESSION" },
    lastRequest: null,
    showGrid: true,
    showAxes: false,
    showPlanetInfoOverlay: true,
    showTrails: true,
    showOrbitPaths: true,
    simulationScale: SimConstants.SCALE.SEMI_REALISTIC,
    cameraPreset: "top-down",
    displayFrame: "helio",
  };
  store.dispatch(loadSimulation(params));
  store.dispatch(
    appendChunkToBuffer({
      bodyNames: ["Sun"],
      bodyCount: 1,
      timestepCount: totalTimesteps,
      positions: new Float64Array(totalTimesteps * 6),
      timestamps: new BigInt64Array(totalTimesteps),
      mu: { Sun: 1 },
    }),
  );
}

describe("simulationUpdateDataMiddleware — speed-aware prefetch threshold", () => {
  beforeEach(() => {
    vi.mocked(dispatchChunkRequest).mockClear();
  });

  it("speed=1, default EMA: formula yields 90, MIN_THRESHOLD=1000 clamps → fires at remaining≤1000", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    // Remaining = 100_000 - 99_000 = 1000 → threshold reached.
    store.dispatch(setCurrentTimeStepIndex(99_000));
    expect(dispatchChunkRequest).toHaveBeenCalledTimes(1);
  });

  it("speed=1, default EMA: does NOT fire at remaining=1001", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    // Remaining = 100_000 - 98_999 = 1001 → above threshold.
    store.dispatch(setCurrentTimeStepIndex(98_999));
    expect(dispatchChunkRequest).not.toHaveBeenCalled();
  });

  it("speed=128, default EMA: threshold scales to 11520 (128 × 60 × 1.0 × 1.5)", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    // 1 → 2 → 4 → 8 → 16 → 32 → 64 → 128 (seven "increase" dispatches).
    for (let i = 0; i < 7; i++) store.dispatch(setSpeedMultiplier("increase"));

    // Remaining = 100_000 - 88_480 = 11_520 → threshold reached at speed=128.
    store.dispatch(setCurrentTimeStepIndex(88_480));
    expect(dispatchChunkRequest).toHaveBeenCalledTimes(1);
  });

  it("speed=128, default EMA: does NOT fire at remaining=11521", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    for (let i = 0; i < 7; i++) store.dispatch(setSpeedMultiplier("increase"));

    store.dispatch(setCurrentTimeStepIndex(88_479));
    expect(dispatchChunkRequest).not.toHaveBeenCalled();
  });

  it("threshold reacts to fetch-latency EMA (2× latency → 2× formula)", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    // Drive EMA upward by a couple of "slow" samples.
    // EMA starts at 1000. α=0.3.
    // After recordFetchLatency(5000): 0.7*1000 + 0.3*5000 = 2200.
    // After recordFetchLatency(5000): 0.7*2200 + 0.3*5000 = 3040.
    store.dispatch(recordFetchLatency(5000));
    store.dispatch(recordFetchLatency(5000));

    // At speed=32, EMA=3040ms: 32 × 60 × (3040/1000) × 1.5 = 8755.2 → ceil = 8756.
    for (let i = 0; i < 5; i++) store.dispatch(setSpeedMultiplier("increase"));

    // Remaining = 100_000 - 91_244 = 8756 → fires.
    store.dispatch(setCurrentTimeStepIndex(91_244));
    expect(dispatchChunkRequest).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when isRequestInProgress=true (even if remaining is below threshold)", () => {
    const store = buildStore();
    seedSession(store, 100_000);
    store.dispatch(setRequestInProgress(true));

    store.dispatch(setCurrentTimeStepIndex(99_000));
    expect(dispatchChunkRequest).not.toHaveBeenCalled();
  });

  it("does NOT fire when buffer is null (pre-session)", () => {
    const store = buildStore();
    // No seedSession — chunkBuffer is null.
    store.dispatch(setCurrentTimeStepIndex(99_000));
    expect(dispatchChunkRequest).not.toHaveBeenCalled();
  });
});
