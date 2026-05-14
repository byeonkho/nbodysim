import { beforeEach, describe, expect, it, vi } from "vitest";
import { userActionLogger } from "./userActionLogger";

// Tests the action → message map plus the post-next() ordering and
// the recursion guard. State is hand-rolled (no real store) so we
// can assert exact pushEvent payloads without dragging in the rest
// of the slice graph.

interface FakeState {
  simulation: {
    timeState: { isPaused: boolean; speedMultiplier: number };
    simulationParameters: {
      simulationScale: { name: string };
      showGrid: boolean;
      showAxes: boolean;
      showTrails: boolean;
      showOrbitPaths: boolean;
      showPlanetInfoOverlay: boolean;
      lastRequest: {
        celestialBodyNames: string[];
        integrator: string;
        frame: string;
      } | null;
    };
    activeBodyState: { activeBodyName: string | null };
  };
}

function baseState(overrides?: Partial<FakeState["simulation"]>): FakeState {
  return {
    simulation: {
      timeState: { isPaused: false, speedMultiplier: 1 },
      simulationParameters: {
        simulationScale: { name: "Realistic" },
        showGrid: false,
        showAxes: false,
        showTrails: true,
        showOrbitPaths: true,
        showPlanetInfoOverlay: false,
        lastRequest: null,
      },
      activeBodyState: { activeBodyName: null },
      ...overrides,
    },
  };
}

interface RunResult {
  dispatch: ReturnType<typeof vi.fn>;
  next: ReturnType<typeof vi.fn>;
  callOrder: string[];
}

function runMiddleware(
  action: { type: string; payload?: unknown },
  state: FakeState,
): RunResult {
  const callOrder: string[] = [];
  const next = vi.fn((a) => {
    callOrder.push("next");
    return a;
  });
  const dispatch = vi.fn(() => {
    callOrder.push("dispatch");
  });
  // userActionLogger is `Middleware`, signature: (store) => (next) => (action)
  const middleware = userActionLogger as unknown as (store: {
    getState: () => FakeState;
    dispatch: typeof dispatch;
  }) => (next: typeof next) => (action: unknown) => unknown;
  middleware({ getState: () => state, dispatch })(next)(action);
  return { dispatch, next, callOrder };
}

// Helper: assert dispatch was called with a USR pushEvent containing
// the expected message. Ignores ts (Date.now()) so the test isn't
// brittle to clock.
function expectMessage(dispatch: ReturnType<typeof vi.fn>, message: string) {
  expect(dispatch).toHaveBeenCalledTimes(1);
  const arg = dispatch.mock.calls[0][0] as {
    type: string;
    payload: { source: string; severity: string; message: string };
  };
  expect(arg.type).toBe("eventLog/pushEvent");
  expect(arg.payload.source).toBe("USR");
  expect(arg.payload.severity).toBe("user");
  expect(arg.payload.message).toBe(message);
}

describe("userActionLogger — ordering and recursion guard", () => {
  it("calls next() before reading state for message generation", () => {
    // After togglePause, isPaused=true should yield "Paused". If the
    // middleware read state before next(), it would see the pre-toggle
    // value (false) and produce "Resumed".
    const { callOrder, dispatch } = runMiddleware(
      { type: "simulation/togglePause" },
      baseState({ timeState: { isPaused: true, speedMultiplier: 1 } }),
    );
    expect(callOrder[0]).toBe("next");
    expectMessage(dispatch, "Paused");
  });

  it("does NOT recurse on its own pushEvent dispatch", () => {
    const { dispatch } = runMiddleware(
      {
        type: "eventLog/pushEvent",
        payload: { source: "USR", severity: "user", message: "test" },
      },
      baseState(),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ignores unknown action types silently", () => {
    const { dispatch } = runMiddleware(
      { type: "unrelated/action" },
      baseState(),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("userActionLogger — message map", () => {
  let state: FakeState;
  beforeEach(() => {
    state = baseState();
  });

  it("togglePause → Paused when newly paused", () => {
    state.simulation.timeState.isPaused = true;
    const { dispatch } = runMiddleware(
      { type: "simulation/togglePause" },
      state,
    );
    expectMessage(dispatch, "Paused");
  });

  it("togglePause → Resumed when newly playing", () => {
    state.simulation.timeState.isPaused = false;
    const { dispatch } = runMiddleware(
      { type: "simulation/togglePause" },
      state,
    );
    expectMessage(dispatch, "Resumed");
  });

  it("setSpeedMultiplier → Speed → Nx", () => {
    state.simulation.timeState.speedMultiplier = 8;
    const { dispatch } = runMiddleware(
      { type: "simulation/setSpeedMultiplier" },
      state,
    );
    expectMessage(dispatch, "Speed → 8×");
  });

  it("cycleSimulationScale → Scale → name", () => {
    state.simulation.simulationParameters.simulationScale.name = "Semi-Realistic";
    const { dispatch } = runMiddleware(
      { type: "simulation/cycleSimulationScale" },
      state,
    );
    expectMessage(dispatch, "Scale → Semi-Realistic");
  });

  it("toggleShowGrid → Grid: on/off", () => {
    state.simulation.simulationParameters.showGrid = true;
    expectMessage(
      runMiddleware({ type: "simulation/toggleShowGrid" }, state).dispatch,
      "Grid: on",
    );
    state.simulation.simulationParameters.showGrid = false;
    expectMessage(
      runMiddleware({ type: "simulation/toggleShowGrid" }, state).dispatch,
      "Grid: off",
    );
  });

  it("toggleShowAxes / Trails / PlanetInfoOverlay each map to a single line", () => {
    state.simulation.simulationParameters.showAxes = true;
    expectMessage(
      runMiddleware({ type: "simulation/toggleShowAxes" }, state).dispatch,
      "Axes: on",
    );
    state.simulation.simulationParameters.showTrails = false;
    expectMessage(
      runMiddleware({ type: "simulation/toggleShowTrails" }, state).dispatch,
      "Trails: off",
    );
    state.simulation.simulationParameters.showPlanetInfoOverlay = true;
    expectMessage(
      runMiddleware(
        { type: "simulation/toggleShowPlanetInfoOverlay" },
        state,
      ).dispatch,
      "Labels: on",
    );
  });

  it("setActiveBody → Now tracking · {name}", () => {
    state.simulation.activeBodyState.activeBodyName = "Earth";
    const { dispatch } = runMiddleware(
      { type: "simulation/setActiveBody" },
      state,
    );
    expectMessage(dispatch, "Now tracking · Earth");
  });

  it("setActiveBody handles null name gracefully", () => {
    state.simulation.activeBodyState.activeBodyName = null;
    const { dispatch } = runMiddleware(
      { type: "simulation/setActiveBody" },
      state,
    );
    expectMessage(dispatch, "Now tracking · —");
  });

  it("setLastSimRequest → Sim init · N bodies, INTEGRATOR, Frame", () => {
    state.simulation.simulationParameters.lastRequest = {
      celestialBodyNames: ["Sun", "Earth", "Moon"],
      integrator: "rk4",
      frame: "Heliocentric",
    };
    const { dispatch } = runMiddleware(
      { type: "simulation/setLastSimRequest" },
      state,
    );
    expectMessage(dispatch, "Sim init · 3 bodies, RK4, Heliocentric");
  });

  it("setLastSimRequest with null lastRequest emits nothing", () => {
    state.simulation.simulationParameters.lastRequest = null;
    const { dispatch } = runMiddleware(
      { type: "simulation/setLastSimRequest" },
      state,
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
});
