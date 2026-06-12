import { describe, it, expect } from "vitest";
import reducer, {
  setOverlayEnabled,
  setBodyAnchors,
  setTrueTrack,
  resetGroundTruth,
  type GroundTruthState,
} from "@/app/store/slices/GroundTruthSlice";
import { createChunkBuffer } from "@/app/store/chunkBuffer";

const initial: GroundTruthState = reducer(undefined, { type: "@@INIT" });

describe("GroundTruthSlice", () => {
  it("toggles the overlay flag", () => {
    const s = reducer(initial, setOverlayEnabled(true));
    expect(s.overlayEnabled).toBe(true);
  });

  it("stores a body's anchors (keyed upper) and records the covered window", () => {
    const s = reducer(initial, setBodyAnchors({
      body: "earth",
      anchors: [
        { epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
      ],
      fromMs: 0,
      toMs: 1000,
    }));
    expect(s.anchorsByBody["EARTH"].map((a) => a.epochMillis)).toEqual([0, 1000]);
    expect(s.coveredBody).toBe("EARTH");
    expect(s.coveredFromMs).toBe(0);
    expect(s.coveredToMs).toBe(1000);
  });

  it("REPLACES a body's anchors on each fetch (no accumulation)", () => {
    const first = reducer(initial, setBodyAnchors({
      body: "EARTH",
      anchors: [
        { epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 2000, position: [2, 0, 0], velocity: [0, 0, 0] },
      ],
      fromMs: 0,
      toMs: 2000,
    }));
    // A later fetch for a slid window replaces, not appends.
    const second = reducer(first, setBodyAnchors({
      body: "EARTH",
      anchors: [
        { epochMillis: 3000, position: [3, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 4000, position: [4, 0, 0], velocity: [0, 0, 0] },
      ],
      fromMs: 3000,
      toMs: 4000,
    }));
    expect(second.anchorsByBody["EARTH"].map((a) => a.epochMillis)).toEqual([3000, 4000]);
    expect(second.coveredFromMs).toBe(3000);
    expect(second.coveredToMs).toBe(4000);
  });

  it("stores the Tier-2 buffer with its body name", () => {
    const buf = createChunkBuffer(["MARS"], 4);
    const s = reducer(initial, setTrueTrack({ buffer: buf, body: "MARS" }));
    expect(s.trueTrack).toBe(buf);
    expect(s.trueTrackBody).toBe("MARS");
  });

  it("reset clears anchors, covered window, and Tier-2 but preserves the overlay flag", () => {
    let s = reducer(initial, setOverlayEnabled(true));
    s = reducer(s, setBodyAnchors({
      body: "EARTH",
      anchors: [{ epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] }],
      fromMs: 0,
      toMs: 1000,
    }));
    s = reducer(s, resetGroundTruth());
    expect(s.anchorsByBody).toEqual({});
    expect(s.coveredBody).toBeNull();
    expect(s.coveredFromMs).toBeNull();
    expect(s.trueTrack).toBeNull();
    expect(s.overlayEnabled).toBe(true); // user preference survives a resubmit
  });

  // The flag follows the fetch thunk's lifecycle by action TYPE (not the
  // thunk's action creators) so the slice never imports the thunk module,
  // which itself imports this slice.
  it("tracks the fetch lifecycle in fetchInFlight", () => {
    let s = reducer(initial, { type: "groundTruth/fetch/pending" });
    expect(s.fetchInFlight).toBe(true);
    s = reducer(s, { type: "groundTruth/fetch/fulfilled" });
    expect(s.fetchInFlight).toBe(false);
    s = reducer(s, { type: "groundTruth/fetch/pending" });
    s = reducer(s, { type: "groundTruth/fetch/rejected" });
    expect(s.fetchInFlight).toBe(false);
  });

  it("reset clears a stuck fetchInFlight so a new sim never starts spinning", () => {
    let s = reducer(initial, { type: "groundTruth/fetch/pending" });
    s = reducer(s, resetGroundTruth());
    expect(s.fetchInFlight).toBe(false);
  });
});
