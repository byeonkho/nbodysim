import { describe, it, expect } from "vitest";
import { createChunkBuffer, readBodyPositionInto } from "@/app/store/chunkBuffer";
import { buildTrueTrack, shouldExtendWindow, type GroundTruthAnchorLike } from "@/app/store/trueTrack";
import { Vector3 } from "three";

// Build a predicted single-body buffer with explicit timestamps so we can
// align the true track to known keyframe times. (Body identity is irrelevant
// to buildTrueTrack except for naming.)
function predictedWithTimestamps(tsMillis: number[]): ReturnType<typeof createChunkBuffer> {
  const buf = createChunkBuffer(["EARTH"], tsMillis.length);
  for (let i = 0; i < tsMillis.length; i++) {
    buf.timestamps[i] = BigInt(tsMillis[i]);
  }
  buf.totalTimesteps = tsMillis.length;
  return buf;
}

describe("buildTrueTrack", () => {
  const anchors: GroundTruthAnchorLike[] = [
    { epochMillis: 0, position: [0, 0, 0], velocity: [1, 0, 0] },
    { epochMillis: 1000, position: [1, 0, 0], velocity: [1, 0, 0] },
  ];

  it("matches the anchor position when a keyframe coincides with an anchor", () => {
    const predicted = predictedWithTimestamps([0, 1000]);
    const track = buildTrueTrack(anchors, predicted, "EARTH");
    const out = new Vector3();
    readBodyPositionInto(out, track, 0, 0);
    expect(out.x).toBeCloseTo(0, 9);
    readBodyPositionInto(out, track, 1, 0);
    expect(out.x).toBeCloseTo(1, 9);
  });

  it("Hermite-interpolates a keyframe halfway between two anchors", () => {
    // Anchor0 (t=0) pos 0 vel 1 m/s; Anchor1 (t=1s) pos 1 vel 1 m/s; span 1s.
    // At s=0.5: h00*0 + h10*1*1 + h01*1 + h11*1*1 = 0.125 + 0.5 - 0.125 = 0.5
    const predicted = predictedWithTimestamps([500]);
    const track = buildTrueTrack(anchors, predicted, "EARTH");
    const out = new Vector3();
    readBodyPositionInto(out, track, 0, 0);
    expect(out.x).toBeCloseTo(0.5, 9);
  });

  it("copies predicted timestamps so the true track stays keyframe-aligned", () => {
    const predicted = predictedWithTimestamps([0, 250, 500, 750, 1000]);
    const track = buildTrueTrack(anchors, predicted, "EARTH");
    expect(track.totalTimesteps).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(track.timestamps[i]).toBe(predicted.timestamps[i]);
    }
  });

  it("clamps to the first anchor before the anchor window starts", () => {
    const predicted = predictedWithTimestamps([-500]);
    const track = buildTrueTrack(anchors, predicted, "EARTH");
    const out = new Vector3();
    readBodyPositionInto(out, track, 0, 0);
    expect(out.x).toBeCloseTo(0, 9); // anchor0 position, no extrapolation
  });

  it("clamps to the last anchor after the anchor window ends", () => {
    const predicted = predictedWithTimestamps([1500]);
    const track = buildTrueTrack(anchors, predicted, "EARTH");
    const out = new Vector3();
    readBodyPositionInto(out, track, 0, 0);
    expect(out.x).toBeCloseTo(1, 9); // anchors[last].position[0]
  });

  it("returns an empty (totalTimesteps 0) buffer when there are no anchors", () => {
    const predicted = predictedWithTimestamps([0, 1000]);
    const track = buildTrueTrack([], predicted, "EARTH");
    expect(track.totalTimesteps).toBe(0);
  });
});

describe("shouldExtendWindow", () => {
  it("is true once the buffer's latest timestamp passes 75% of the window", () => {
    // window [0, 1000]; 75% threshold at 750.
    expect(shouldExtendWindow(760, 0, 1000)).toBe(true);
    expect(shouldExtendWindow(740, 0, 1000)).toBe(false);
  });
  it("is false when the window is unset", () => {
    expect(shouldExtendWindow(999, null, null)).toBe(false);
  });
  it("is true exactly at the 75% threshold (inclusive)", () => {
    expect(shouldExtendWindow(750, 0, 1000)).toBe(true);
  });
});
