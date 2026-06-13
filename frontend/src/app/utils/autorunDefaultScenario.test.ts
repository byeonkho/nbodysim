import { afterEach, describe, expect, it, vi } from "vitest";

const runStaticClipMock = vi.fn();
const runSimulationMock = vi.fn(async () => true);

vi.mock("@/app/utils/runStaticClip", () => ({
  runStaticClip: (...a: unknown[]) => runStaticClipMock(...a),
}));
// Provide the preset constants the module imports alongside a mock launcher,
// so the real runSimulation module (which imports the store) never loads.
vi.mock("@/app/utils/runSimulation", () => ({
  runSimulation: (...a: unknown[]) => runSimulationMock(...a),
  PRESET_EPOCH: "2024-06-05T00:00:00.000",
  PRESET_INTEGRATOR: "rk4",
  PRESET_TIME_UNIT: "Hours",
}));

import { autorunDefaultScenario } from "./autorunDefaultScenario";

const noDispatch = (() => {}) as never;

describe("autorunDefaultScenario", () => {
  afterEach(() => {
    runStaticClipMock.mockReset();
    runSimulationMock.mockClear();
  });

  it("does not run the default sim when the clip plays", async () => {
    runStaticClipMock.mockResolvedValue(true);
    await autorunDefaultScenario(noDispatch, () => undefined);
    expect(runSimulationMock).not.toHaveBeenCalled();
  });

  it("falls back to the default sim when the clip fails and no session exists", async () => {
    runStaticClipMock.mockResolvedValue(false);
    await autorunDefaultScenario(noDispatch, () => undefined);
    expect(runSimulationMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT clobber a session started during the clip load", async () => {
    runStaticClipMock.mockResolvedValue(false);
    await autorunDefaultScenario(noDispatch, () => "session-started-meanwhile");
    expect(runSimulationMock).not.toHaveBeenCalled();
  });
});
