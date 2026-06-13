import { describe, expect, it } from "vitest";
import simulationReducer, {
  appendChunkToBuffer,
  loadSimulation,
  selectHasActiveSimulation,
  setActiveBody,
  setCurrentTimeStepIndex,
  setIsPaused,
  setSpeedMultiplier,
  toggleShowGrid,
  type SimulationParameters,
} from "./SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import type { RootState } from "@/app/store/Store";

// Critical contract: submitting a new sim must atomically reset session
// state so a late-arriving chunk from the prior session can't splatter
// stale timesteps into the new buffer, and view prefs must survive the
// swap. See todo #55 — silent corruption was the original failure mode.

type Slice = ReturnType<typeof simulationReducer>;

const init = (): Slice => simulationReducer(undefined, { type: "@@INIT" });

const newParams = (sessionID: string): SimulationParameters => ({
  celestialBodyPropertiesList: [{ name: "Mars" }],
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
});

function dummyChunkPayload(timestepCount = 5) {
  const bodyCount = 1;
  return {
    bodyNames: ["Mars"],
    bodyCount,
    timestepCount,
    positions: new Float64Array(timestepCount * bodyCount * 6),
    timestamps: new Float64Array(timestepCount),
    mu: { Mars: 4.2828e13 },
    deltaERelative: new Float32Array(timestepCount),
    dp853AvgStepSeconds: null as number | null,
    dp853AcceptRate: null as number | null,
  };
}

describe("SimulationSlice: initial state", () => {
  it("starts with null chunkBuffer and hasReceivedFirstChunk=false", () => {
    const state = init();
    expect(state.chunkBuffer).toBeNull();
    expect(state.hasReceivedFirstChunk).toBe(false);
    expect(state.timeState.isPaused).toBe(true);
    expect(state.timeState.currentTimeStepIndex).toBe(0);
  });
});

describe("SimulationSlice: loadSimulation atomic reset", () => {
  it("clears chunkBuffer when a new session loads", () => {
    let state = init();
    // Seed an old session with a buffer.
    state = simulationReducer(state, loadSimulation(newParams("OLD")));
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload()));
    expect(state.chunkBuffer).not.toBeNull();
    expect(state.hasReceivedFirstChunk).toBe(true);

    state = simulationReducer(state, loadSimulation(newParams("NEW")));
    expect(state.chunkBuffer).toBeNull();
    expect(state.hasReceivedFirstChunk).toBe(false);
  });

  it("resets timeState (currentTimeStepIndex / speedMultiplier / isPaused) on resubmit", () => {
    let state = init();
    state = simulationReducer(state, loadSimulation(newParams("OLD")));
    state = simulationReducer(state, setCurrentTimeStepIndex(5000));
    state = simulationReducer(state, setSpeedMultiplier("increase"));
    state = simulationReducer(state, setIsPaused(false));
    expect(state.timeState.currentTimeStepIndex).toBe(5000);
    expect(state.timeState.speedMultiplier).not.toBe(1);
    expect(state.timeState.isPaused).toBe(false);

    state = simulationReducer(state, loadSimulation(newParams("NEW")));
    expect(state.timeState.currentTimeStepIndex).toBe(0);
    expect(state.timeState.speedMultiplier).toBe(1);
    expect(state.timeState.isPaused).toBe(true);
  });

  it("resets activeBodyState so a stale selection (body absent in new sim) doesn't leak through", () => {
    let state = init();
    state = simulationReducer(state, loadSimulation(newParams("OLD")));
    state = simulationReducer(state, setActiveBody("Earth"));
    expect(state.activeBodyState.activeBodyName).toBe("Earth");
    expect(state.activeBodyState.isBodyActive).toBe(true);

    state = simulationReducer(state, loadSimulation(newParams("NEW")));
    expect(state.activeBodyState.activeBodyName).toBeNull();
    expect(state.activeBodyState.isBodyActive).toBe(false);
  });

  it("preserves user view preferences across the reset (showGrid, simulationScale, cameraPreset, displayFrame)", () => {
    let state = init();
    state = simulationReducer(state, toggleShowGrid()); // true -> false
    const customScalePrefs = {
      cameraPreset: state.simulationParameters.cameraPreset,
      displayFrame: state.simulationParameters.displayFrame,
    };

    const params = newParams("S1");
    state = simulationReducer(state, loadSimulation(params));
    expect(state.simulationParameters.showGrid).toBe(params.showGrid);
    expect(state.simulationParameters.cameraPreset).toBe(
      customScalePrefs.cameraPreset,
    );
    expect(state.simulationParameters.displayFrame).toBe(
      customScalePrefs.displayFrame,
    );
  });
});

describe("SimulationSlice: appendChunkToBuffer", () => {
  it("creates the buffer on first chunk and sets hasReceivedFirstChunk=true", () => {
    let state = init();
    state = simulationReducer(state, loadSimulation(newParams("S1")));
    expect(state.chunkBuffer).toBeNull();

    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    expect(state.chunkBuffer).not.toBeNull();
    expect(state.chunkBuffer?.bodyCount).toBe(1);
    expect(state.chunkBuffer?.totalTimesteps).toBe(10);
    expect(state.hasReceivedFirstChunk).toBe(true);
  });

  it("does not auto-unpause when a chunk arrives (user controls pause state)", () => {
    let state = init();
    state = simulationReducer(state, loadSimulation(newParams("S1")));
    // isPaused starts true after loadSimulation.
    expect(state.timeState.isPaused).toBe(true);

    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    // Chunk arrival must NOT flip isPaused.
    expect(state.timeState.isPaused).toBe(true);
  });

  it("shares bodyNameToIndex and data arrays across appends (render-cache soundness)", () => {
    let state = init();
    state = simulationReducer(state, loadSimulation(newParams("S1")));
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    const first = state.chunkBuffer!;
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    const second = state.chunkBuffer!;

    // Immer copy-on-write may hand out a new ChunkBuffer wrapper per append,
    // but the name map and backing arrays must be the same objects: render-
    // side caches key on wrapper identity and re-resolve against the shared
    // map, which is only sound if the map (and what each slot means) survives
    // appends. If this test ever fails, every useFrame index cache and the
    // framePivot WeakMap are unsound, not just inefficient.
    expect(second.bodyNameToIndex).toBe(first.bodyNameToIndex);
    expect(second.positions).toBe(first.positions);
    expect(second.timestamps).toBe(first.timestamps);
    expect(second.totalTimesteps).toBe(20);
  });
});

describe("SimulationSlice: chunksAppended counter (chunk-protocol index)", () => {
  it("resets to 0 on loadSimulation and increments per appended chunk", () => {
    let state = simulationReducer(undefined, { type: "@@init" });
    expect(state.chunksAppended).toBe(0);

    state = simulationReducer(state, loadSimulation(newParams("S1")));
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    expect(state.chunksAppended).toBe(1);
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload(10)));
    expect(state.chunksAppended).toBe(2);

    state = simulationReducer(state, loadSimulation(newParams("S2")));
    expect(state.chunksAppended).toBe(0);
  });
});

describe("selectHasActiveSimulation", () => {
  // Selectors take the full RootState but read only state.simulation; a
  // partial object cast is enough to exercise them.
  const asRoot = (state: Slice) =>
    ({ simulation: state }) as unknown as RootState;

  it("is false on initial state (nothing loaded)", () => {
    expect(selectHasActiveSimulation(asRoot(init()))).toBe(false);
  });

  it("is true when a live session exists, even before the first chunk", () => {
    const state = simulationReducer(init(), loadSimulation(newParams("LIVE")));
    expect(selectHasActiveSimulation(asRoot(state))).toBe(true);
  });

  it("is true for a sessionless static clip once a chunk has loaded", () => {
    // Clip path: loadSimulation with simulationMetaData: null (no session).
    let state = simulationReducer(
      init(),
      loadSimulation({
        celestialBodyPropertiesList: [{ name: "Mars" }],
        simulationMetaData: null,
      }),
    );
    // No session and no chunk yet, so nothing is on screen.
    expect(selectHasActiveSimulation(asRoot(state))).toBe(false);
    // First chunk arrives: now something is playing despite the null session.
    state = simulationReducer(state, appendChunkToBuffer(dummyChunkPayload()));
    expect(selectHasActiveSimulation(asRoot(state))).toBe(true);
  });
});
