import {
  createChunkBuffer,
  type ChunkBuffer,
} from "@/app/store/chunkBuffer";

// Minimal shape we consume from the wire anchors (generated type is
// components["schemas"]["GroundTruthAnchor"]; this local alias keeps the pure
// util decoupled from the generated file and easy to unit-test).
export interface GroundTruthAnchorLike {
  epochMillis: number;
  position: number[]; // [x, y, z] metres, Sun-relative
  velocity: number[]; // [vx, vy, vz] m/s, Sun-relative
}

// Fraction of the fetched window at which we start fetching the next window.
const EXTEND_AT_FRACTION = 0.75;

/**
 * True once playback's latest buffered timestamp has passed EXTEND_AT_FRACTION
 * of the currently-fetched ground-truth window, so the next window should be
 * fetched before the true track runs out of anchors. False when no window is
 * fetched yet.
 */
export function shouldExtendWindow(
  latestBufferedMillis: number,
  fetchedFromMs: number | null,
  fetchedToMs: number | null,
): boolean {
  if (fetchedFromMs === null || fetchedToMs === null) return false;
  const threshold = fetchedFromMs + (fetchedToMs - fetchedFromMs) * EXTEND_AT_FRACTION;
  return latestBufferedMillis >= threshold;
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
 * `anchors` must be sorted ascending by epochMillis and non-empty.
 */
export function buildTrueTrack(
  anchors: GroundTruthAnchorLike[],
  predicted: ChunkBuffer,
  bodyName: string,
): ChunkBuffer {
  if (anchors.length === 0) {
    return createChunkBuffer([bodyName], Math.max(1, predicted.capacity));
  }

  const n = predicted.totalTimesteps;
  const track = createChunkBuffer([bodyName], Math.max(1, predicted.capacity));

  const last = anchors.length - 1;
  let cursor = 0; // monotonic anchor cursor; predicted timestamps are ascending

  for (let i = 0; i < n; i++) {
    const t = Number(predicted.timestamps[i]);
    const base = i * 6; // single body → stride is 6

    // Clamp outside the anchor window (no extrapolation).
    if (t <= anchors[0].epochMillis || anchors.length === 1) {
      writeAnchor(track.positions, base, anchors[0]);
    } else if (t >= anchors[last].epochMillis) {
      writeAnchor(track.positions, base, anchors[last]);
    } else {
      // Advance the cursor so anchors[cursor], anchors[cursor+1] bracket t.
      while (cursor < last - 1 && anchors[cursor + 1].epochMillis <= t) cursor++;
      hermiteInto(track.positions, base, anchors[cursor], anchors[cursor + 1], t);
    }

    track.timestamps[i] = predicted.timestamps[i];
  }

  track.totalTimesteps = n;
  return track;
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
