import { describe, it, expect } from "vitest";
import reducer, {
  setOverlayEnabled,
  mergeAnchors,
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

  it("merges anchors and advances the window, deduping the boundary anchor", () => {
    const first = reducer(initial, mergeAnchors({
      tracks: [{ name: "EARTH", anchors: [
        { epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
      ] }],
      fromMs: 0,
      toMs: 1000,
    }));
    const second = reducer(first, mergeAnchors({
      tracks: [{ name: "EARTH", anchors: [
        // boundary anchor at 1000 duplicates the prior window's last anchor
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 2000, position: [2, 0, 0], velocity: [0, 0, 0] },
      ] }],
      fromMs: 1000,
      toMs: 2000,
    }));
    expect(second.anchorsByBody["EARTH"].map((a) => a.epochMillis)).toEqual([0, 1000, 2000]);
    expect(second.fetchedFromMs).toBe(0);
    expect(second.fetchedToMs).toBe(2000);
  });

  it("stores the Tier-2 buffer with its body name", () => {
    const buf = createChunkBuffer(["MARS"], 4);
    const s = reducer(initial, setTrueTrack({ buffer: buf, body: "MARS" }));
    expect(s.trueTrack).toBe(buf);
    expect(s.trueTrackBody).toBe("MARS");
  });

  it("is idempotent against an overlapping re-fetched window (drops all anchors <= last stored epoch)", () => {
    const first = reducer(initial, mergeAnchors({
      tracks: [{ name: "EARTH", anchors: [
        { epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
      ] }],
      fromMs: 0, toMs: 1000,
    }));
    // A redundant fetch whose window overlaps everything already stored, plus one new anchor.
    const second = reducer(first, mergeAnchors({
      tracks: [{ name: "EARTH", anchors: [
        { epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 1000, position: [1, 0, 0], velocity: [0, 0, 0] },
        { epochMillis: 2000, position: [2, 0, 0], velocity: [0, 0, 0] },
      ] }],
      fromMs: 0, toMs: 2000,
    }));
    // No duplicates, strictly ascending.
    expect(second.anchorsByBody["EARTH"].map((a) => a.epochMillis)).toEqual([0, 1000, 2000]);
  });

  it("reset clears anchors, window, and Tier-2 but preserves the overlay flag", () => {
    let s = reducer(initial, setOverlayEnabled(true));
    s = reducer(s, mergeAnchors({
      tracks: [{ name: "EARTH", anchors: [{ epochMillis: 0, position: [0, 0, 0], velocity: [0, 0, 0] }] }],
      fromMs: 0, toMs: 1000,
    }));
    s = reducer(s, resetGroundTruth());
    expect(s.anchorsByBody).toEqual({});
    expect(s.fetchedFromMs).toBeNull();
    expect(s.trueTrack).toBeNull();
    expect(s.overlayEnabled).toBe(true); // user preference survives a resubmit
  });
});
