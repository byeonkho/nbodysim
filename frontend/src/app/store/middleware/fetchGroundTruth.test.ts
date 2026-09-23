import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import groundTruthReducer from "@/app/store/slices/GroundTruthSlice";
import { fetchGroundTruth } from "./fetchGroundTruth";
import { beginLaunch, resetLaunchEpochForTests } from "@/app/store/launchEpoch";

function makeStore() {
  return configureStore({
    reducer: { groundTruth: groundTruthReducer },
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }),
  });
}

const args = {
  frame: "heliocentric",
  body: "EARTH",
  fromMs: 1000,
  toMs: 5000,
  stepSeconds: 86_400,
  subtractSun: true,
  immediate: true,
};

describe("fetchGroundTruth stale-launch guard", () => {
  beforeEach(() => {
    resetLaunchEpochForTests();
    beginLaunch(); // establish the current launch (epoch 1)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          tracks: [
            {
              name: "EARTH",
              anchors: [
                { epochMillis: 1000, position: [1, 2, 3], velocity: [0, 0, 0] },
              ],
            },
          ],
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records anchors when no newer launch superseded the fetch", async () => {
    const store = makeStore();
    await store.dispatch(fetchGroundTruth(args));
    expect(store.getState().groundTruth.coveredByBody.EARTH.toMs).toBe(1000);
    expect(store.getState().groundTruth.anchorsByBody.EARTH).toHaveLength(1);
  });

  it("keeps the newest window when same-launch responses arrive out of order", async () => {
    const responses: Array<(value: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => responses.push(resolve))),
    );
    const store = makeStore();
    const first = store.dispatch(fetchGroundTruth(args));
    const second = store.dispatch(
      fetchGroundTruth({ ...args, fromMs: 9000, toMs: 10000 }),
    );
    const response = (epochMillis: number) => ({
      ok: true,
      json: async () => ({
        tracks: [
          {
            name: "EARTH",
            anchors: [
              { epochMillis, position: [1, 2, 3], velocity: [0, 0, 0] },
            ],
          },
        ],
      }),
    });
    responses[1](response(9000));
    await second;
    responses[0](response(1000));
    await first;
    expect(store.getState().groundTruth.coveredByBody.EARTH).toEqual({
      fromMs: 9000,
      toMs: 9000,
    });
  });

  it("drops the response when a newer launch began before it settled", async () => {
    const store = makeStore();
    const p = store.dispatch(fetchGroundTruth(args)); // captures epoch 1 synchronously
    beginLaunch(); // epoch -> 2, simulating a resubmit mid-fetch
    await p;
    expect(store.getState().groundTruth.coveredByBody.EARTH).toBeUndefined();
    expect(store.getState().groundTruth.anchorsByBody.EARTH).toBeUndefined();
  });
});
