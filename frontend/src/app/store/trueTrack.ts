import type { ChunkBuffer } from "@/app/store/chunkBuffer";

// Minimal shape we consume from the wire anchors (generated type is
// components["schemas"]["GroundTruthAnchor"]; this local alias keeps the pure
// util decoupled from the generated file and easy to unit-test).
export interface GroundTruthAnchorLike {
  epochMillis: number;
  position: number[]; // [x, y, z] metres; Sun-relative iff subtractSun was set when fetched
  velocity: number[]; // [vx, vy, vz] m/s; Sun-relative iff subtractSun was set when fetched
}

export interface TrueTrackRequest {
  fromMs: number;
  toMs: number;
  stepSeconds: number;
}

/**
 * Computes the ground-truth fetch window + cadence for the active body, scoped
 * to the VISIBLE read window: the trail keyframes behind the playback head plus
 * a lookahead ahead of it. Sizing the window to what's on screen (rather than
 * the whole, potentially decades-deep, buffer) keeps the anchor count bounded
 * AND keeps the cadence fine enough that the marker/trail interpolate smoothly,
 * at any simulation time-step.
 *
 * The cadence is the larger of (a) the average keyframe spacing — no point
 * sampling truth finer than the keyframes we interpolate onto — and (b) the
 * span divided by `targetAnchors`, so a wide window stays under the anchor
 * budget. Returns null when the buffer is too small to fetch for.
 *
 * Window bounds are read straight from the predicted buffer's timestamps, so
 * they share the wire's millis-UTC scale (anchors will align to keyframes).
 */
export function computeTrueTrackRequest(
  buffer: ChunkBuffer,
  currentIdx: number,
  trailLength: number,
  lookaheadKeyframes: number,
  targetAnchors: number,
): TrueTrackRequest | null {
  const n = buffer.totalTimesteps;
  if (n < 2) return null;
  const idxFloor = Math.max(0, Math.min(n - 1, Math.floor(currentIdx)));
  const lo = Math.max(0, idxFloor - trailLength);
  const hi = Math.min(n - 1, idxFloor + lookaheadKeyframes);
  if (hi <= lo) return null;

  const fromMs = Number(buffer.timestamps[lo]);
  const toMs = Number(buffer.timestamps[hi]);
  const spanMs = toMs - fromMs;
  if (spanMs <= 0) return null;

  const keyframeSpanMs = spanMs / (hi - lo); // average keyframe spacing
  const targetStepMs = spanMs / targetAnchors;
  const stepMs = Math.max(keyframeSpanMs, targetStepMs);
  return { fromMs, toMs, stepSeconds: stepMs / 1000 };
}

// Reusable single-body track arrays per session, keyed on the predicted
// buffer's positions array. That array is created once per session and shared
// across every Immer copy-on-write wrapper (the buffer's scalar fields change
// per append, but the typed arrays do not), so it is the stable per-session
// identity; a new session gets a new positions array and a fresh entry, and the
// old one is garbage-collected with the old buffer. This turns the per-append
// rebuild from a ~600 KB allocation into an in-place overwrite, mirroring the
// framePivot WeakMap cache.
const trackArraysBySession = new WeakMap<
  Float64Array,
  { positions: Float64Array; timestamps: BigInt64Array; deltaERelative: Float32Array }
>();

function trackArraysFor(predicted: ChunkBuffer) {
  const cap = Math.max(1, predicted.capacity);
  let arrays = trackArraysBySession.get(predicted.positions);
  if (!arrays || arrays.timestamps.length < cap) {
    arrays = {
      positions: new Float64Array(cap * 6), // single body, stride 6
      timestamps: new BigInt64Array(cap),
      deltaERelative: new Float32Array(cap), // unused by the track, kept for shape
    };
    trackArraysBySession.set(predicted.positions, arrays);
  }
  return arrays;
}

function wrapTrack(
  arrays: { positions: Float64Array; timestamps: BigInt64Array; deltaERelative: Float32Array },
  bodyName: string,
  totalTimesteps: number,
): ChunkBuffer {
  // Fresh wrapper around the reused arrays: identity changes so selectors and
  // React re-render, but the big arrays are not reallocated.
  return {
    positions: arrays.positions,
    timestamps: arrays.timestamps,
    deltaERelative: arrays.deltaERelative,
    bodyNames: [bodyName],
    bodyNameToIndex: new Map([[bodyName, 0]]),
    bodyCount: 1,
    capacity: arrays.timestamps.length,
    totalTimesteps,
    bufferStartTimestep: 0,
    dp853AvgStepSeconds: null,
    dp853AcceptRate: null,
  };
}

/**
 * Builds a dense, keyframe-aligned single-body ChunkBuffer of TRUE positions
 * for `bodyName`, by cubic-Hermite-interpolating the sparse `anchors` at each
 * of the predicted buffer's keyframe timestamps. Stores position AND the
 * analytic-derivative velocity per keyframe, so the render layer can read it
 * with the same `readBodyPositionInto` Hermite path the predicted body uses.
 *
 * The returned buffer shares the predicted buffer's timestamps and
 * totalTimesteps, so the true trail occupies the same window and evicts in
 * lockstep (rebuilt whenever the predicted buffer changes).
 *
 * The underlying typed arrays are reused across rebuilds for the same session
 * (keyed on the predicted buffer's stable positions array). Each call returns a
 * fresh lightweight wrapper object so Redux selectors and React see the update.
 *
 * `anchors` must be sorted ascending by epochMillis and non-empty.
 */
export function buildTrueTrack(
  anchors: GroundTruthAnchorLike[],
  predicted: ChunkBuffer,
  bodyName: string,
): ChunkBuffer {
  const arrays = trackArraysFor(predicted);
  if (anchors.length === 0) {
    return wrapTrack(arrays, bodyName, 0);
  }

  const n = predicted.totalTimesteps;
  const positions = arrays.positions;
  const last = anchors.length - 1;
  let cursor = 0; // monotonic anchor cursor; predicted timestamps are ascending

  for (let i = 0; i < n; i++) {
    const t = Number(predicted.timestamps[i]);
    const base = i * 6; // single body, stride 6

    // Clamp outside the anchor window (no extrapolation).
    if (t <= anchors[0].epochMillis || anchors.length === 1) {
      writeAnchor(positions, base, anchors[0]);
    } else if (t >= anchors[last].epochMillis) {
      writeAnchor(positions, base, anchors[last]);
    } else {
      // Advance the cursor so anchors[cursor], anchors[cursor+1] bracket t.
      while (cursor < last - 1 && anchors[cursor + 1].epochMillis <= t) cursor++;
      hermiteInto(positions, base, anchors[cursor], anchors[cursor + 1], t);
    }

    arrays.timestamps[i] = predicted.timestamps[i];
  }

  return wrapTrack(arrays, bodyName, n);
}

// Writes [px,py,pz, vx,vy,vz] of an anchor directly (used at clamp boundaries).
function writeAnchor(out: Float64Array, base: number, a: GroundTruthAnchorLike): void {
  out[base] = a.position[0];
  out[base + 1] = a.position[1];
  out[base + 2] = a.position[2];
  out[base + 3] = a.velocity[0];
  out[base + 4] = a.velocity[1];
  out[base + 5] = a.velocity[2];
}

// Cubic Hermite (position) + its analytic derivative (velocity) between two
// anchors at time t. Identical basis to chunkBuffer.readBodyPositionInto /
// readBodyStateInto: tangents are the stored velocities scaled by the interval
// in seconds.
function hermiteInto(
  out: Float64Array,
  base: number,
  a0: GroundTruthAnchorLike,
  a1: GroundTruthAnchorLike,
  t: number,
): void {
  const spanMs = a1.epochMillis - a0.epochMillis;
  const s = (t - a0.epochMillis) / spanMs;
  const dt = spanMs / 1000; // seconds
  const invDt = 1 / dt;

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const dh00 = 6 * s2 - 6 * s;
  const dh10 = 3 * s2 - 4 * s + 1;
  const dh01 = -6 * s2 + 6 * s;
  const dh11 = 3 * s2 - 2 * s;

  for (let c = 0; c < 3; c++) {
    const p0 = a0.position[c];
    const v0 = a0.velocity[c];
    const p1 = a1.position[c];
    const v1 = a1.velocity[c];
    out[base + c] = h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
    out[base + 3 + c] = (dh00 * p0 + dh01 * p1) * invDt + dh10 * v0 + dh11 * v1;
  }
}
