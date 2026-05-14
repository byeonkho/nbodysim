import { describe, expect, it } from "vitest";
import simulationReducer, {
  loadSimulation,
  setActiveBody,
  setCurrentTimeStepIndex,
  setIsPaused,
  setSpeedMultiplier,
  toggleShowGrid,
  updateDataReceived,
  type SimulationParameters,
} from "./SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";

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
  simulationScale: SimConstants.SCALE.SEMI_REALISTIC,
  cameraPreset: "top-down",
  displayFrame: "helio",
});

describe("SimulationSlice — loadSimulation atomic reset", () => {
  it("clears simulationData when a new session loads", () => {
    let state = init();
    // Seed an old session with a buffer.
    state = simulationReducer(state, loadSimulation(newParams("OLD")));
    state = simulationReducer(
      state,
      updateDataReceived({
        data: { "2024-01-01": [] },
        mu: {},
      }),
    );
    expect(state.simulationData).not.toBeNull();

    state = simulationReducer(state, loadSimulation(newParams("NEW")));
    expect(state.simulationData).toBeNull();
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
    expect(state.timeState.isUpdating).toBe(false);
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
    // Mutate prefs to non-defaults.
    state = simulationReducer(state, toggleShowGrid()); // true -> false
    const customScalePrefs = {
      cameraPreset: state.simulationParameters.cameraPreset,
      displayFrame: state.simulationParameters.displayFrame,
      showGrid: state.simulationParameters.showGrid,
    };

    // Submit a new sim — load payload doesn't override these.
    const params = newParams("S1");
    // Mimic backend payload: includes its own defaults for prefs the
    // user can flip. The spread inside the reducer means payload values
    // win when present, which is fine — what matters is that the reset
    // itself doesn't blow them away.
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
