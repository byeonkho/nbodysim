import { describe, it, expect } from "vitest";
import { createChunkBuffer, readBodyPositionInto } from "@/app/store/chunkBuffer";
import { buildTrueTrack, computeTrueTrackRequest, type GroundTruthAnchorLike } from "@/app/store/trueTrack";
import { Vector3 } from "three";

// Build a predicted single-body buffer with explicit timestamps so we can
// align the true track to known keyframe times. (Body identity is irrelevant
// to buildTrueTrack except for naming.)
function predictedWithTimestamps(tsMillis: number[]): ReturnType<typeof createChunkBuffer> {
  const buf = createChunkBuffer(["EARTH"], tsMillis.length);
  for (let i = 0; i < tsMillis.length; i++) {
    buf.timestamps[i] = tsMillis[i];
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

  it("reuses the typed arrays across rebuilds for the same session", () => {
    const predicted = predictedWithTimestamps([0, 500, 1000]);
    const t1 = buildTrueTrack(anchors, predicted, "EARTH");
    const t2 = buildTrueTrack(anchors, predicted, "EARTH");
    expect(t1).not.toBe(t2); // fresh wrapper each call so Redux/React see the update
    expect(t1.positions).toBe(t2.positions); // big arrays reused, no realloc
    expect(t1.timestamps).toBe(t2.timestamps);
  });

  it("allocates a distinct array for a different session buffer", () => {
    const a = predictedWithTimestamps([0, 500, 1000]);
    const b = predictedWithTimestamps([0, 500, 1000]);
    const ta = buildTrueTrack(anchors, a, "EARTH");
    const tb = buildTrueTrack(anchors, b, "EARTH");
    expect(ta.positions).not.toBe(tb.positions);
  });
});

describe("computeTrueTrackRequest", () => {
  it("scopes the window to [idx - trail, idx + lookahead] and reads its timestamps", () => {
    const buf = predictedWithTimestamps([0, 1000, 2000, 3000, 4000]);
    // idx 2, trail 1, lookahead 1 → lo=1, hi=3 → [1000, 3000].
    const req = computeTrueTrackRequest(buf, 2, 1, 1, /*target*/ 100);
    expect(req).not.toBeNull();
    expect(req!.fromMs).toBe(1000);
    expect(req!.toMs).toBe(3000);
  });

  it("clamps the window to the buffer bounds", () => {
    const buf = predictedWithTimestamps([0, 1000, 2000, 3000, 4000]);
    // Big trail + lookahead → clamps to [0, 4000].
    const req = computeTrueTrackRequest(buf, 0, 999, 999, 100);
    expect(req!.fromMs).toBe(0);
    expect(req!.toMs).toBe(4000);
  });

  it("uses the average keyframe spacing as the cadence floor (no oversampling)", () => {
    const buf = predictedWithTimestamps([0, 1000, 2000]);
    // span 2000ms over 2 intervals → keyframe spacing 1000ms = 1s. A generous
    // target would ask for finer, but cadence floors at the keyframe spacing.
    const req = computeTrueTrackRequest(buf, 1, 1, 1, /*target*/ 1000);
    expect(req!.stepSeconds).toBeCloseTo(1, 9); // 1000ms / 1000
  });

  it("uses span/target as the cadence when that's coarser than keyframe spacing", () => {
    // 11 keyframes 1000ms apart (span 10000ms). target 5 → span/target = 2000ms,
    // coarser than the 1000ms keyframe spacing, so cadence = 2000ms = 2s.
    const buf = predictedWithTimestamps([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
    const req = computeTrueTrackRequest(buf, 0, 0, 10, /*target*/ 5);
    expect(req!.stepSeconds).toBeCloseTo(2, 9);
  });

  it("returns null for a buffer with fewer than 2 timesteps", () => {
    const buf = predictedWithTimestamps([0]);
    expect(computeTrueTrackRequest(buf, 0, 100, 100, 100)).toBeNull();
  });
});
