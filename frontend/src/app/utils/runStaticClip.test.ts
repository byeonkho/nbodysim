import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendChunkToBuffer,
  loadSimulation,
} from "@/app/store/slices/SimulationSlice";
import { beginLaunch, resetLaunchEpochForTests } from "@/app/store/launchEpoch";
import { DEFAULT_CLIP_ID } from "@/app/constants/ClipPresets";

// The clip bundle parser and budget check are mocked so the test drives the
// decode loop directly without a real asset. importOriginal keeps the rest of
// chunkBuffer intact (the slice imports createChunkBuffer from it).
vi.mock("@/app/utils/presetClipBundle", () => ({
  clipUrl: () => "http://test/clip.bin",
  parsePresetClipBundle: () => ({
    manifest: {
      celestialBodyPropertiesList: [],
      params: {
        bodies: ["EARTH"],
        epoch: "2024-06-05T00:00:00.000",
        frame: "Heliocentric",
        integrator: "rk4",
        timeStepUnit: "Hours",
        fidelityBucket: "medLow",
      },
    },
    chunks: [new Uint8Array(8), new Uint8Array(8)], // two chunks
  }),
}));

vi.mock("@/app/store/chunkBuffer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/store/chunkBuffer")>();
  return { ...actual, clipFitsClientBudget: () => true };
});

// Fully mock the thunk module so importing it never instantiates the worker.
const decodeMock = vi.fn(async () => ({
  bodyNames: ["EARTH"],
  bodyCount: 1,
  timestepCount: 1,
  positions: new Float64Array(6),
  timestamps: new Float64Array(1),
  mu: { EARTH: 1 },
  deltaERelative: new Float32Array(1),
  dp853AvgStepSeconds: null,
  dp853AcceptRate: null,
}));
vi.mock("@/app/store/middleware/simulationRequestThunk", () => ({
  decodeOffMainThread: (buf: ArrayBuffer) => decodeMock(buf),
}));

import { runStaticClip } from "./runStaticClip";

describe("runStaticClip stale-launch guard", () => {
  beforeEach(() => {
    resetLaunchEpochForTests();
    decodeMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends every chunk when nothing supersedes the launch", async () => {
    let appendCount = 0;
    const dispatch = vi.fn((action: unknown) => {
      if (appendChunkToBuffer.match(action as never)) appendCount++;
      return action;
    });
    const ok = await runStaticClip(dispatch as never, DEFAULT_CLIP_ID);
    expect(ok).toBe(true);
    expect(appendCount).toBe(2);
  });

  it("stops appending once a newer launch supersedes it", async () => {
    let appendCount = 0;
    const dispatch = vi.fn((action: unknown) => {
      if (appendChunkToBuffer.match(action as never)) {
        appendCount++;
        if (appendCount === 1) beginLaunch(); // a competing launch lands mid-loop
      }
      return action;
    });
    const ok = await runStaticClip(dispatch as never, DEFAULT_CLIP_ID);
    expect(ok).toBe(false);
    expect(appendCount).toBe(1); // the second chunk is dropped by the guard
  });

  it("abandons the clip before loadSimulation when a newer launch supersedes during the asset fetch", async () => {
    // A competing launch lands while the asset is still fetching, before the
    // clip has dispatched anything. The pre-load guard must bail so the clip's
    // loadSimulation never wipes the newer run's freshly-built state.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        beginLaunch(); // newer launch supersedes this clip mid-fetch
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      }),
    );
    let loadCount = 0;
    let appendCount = 0;
    const dispatch = vi.fn((action: unknown) => {
      if (loadSimulation.match(action as never)) loadCount++;
      if (appendChunkToBuffer.match(action as never)) appendCount++;
      return action;
    });
    const ok = await runStaticClip(dispatch as never, DEFAULT_CLIP_ID);
    expect(ok).toBe(false);
    expect(loadCount).toBe(0); // guard fired before the first store mutation
    expect(appendCount).toBe(0);
  });
});
