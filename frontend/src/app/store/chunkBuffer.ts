import type { Vector3 as ThreeVector3 } from "three";

// Typed-array-backed buffer of simulation snapshots. Mirrors the backend's
// CelestialBodySnapshot layout (6 doubles per body per timestep: px, py, pz,
// vx, vy, vz) — the same flat layout the wire format ships, so the decode
// worker can write directly into this with no intermediate JS-object hops.
//
// Lookup is O(1) by timestep index, eliminating the Object.keys() / map.find
// hot-path costs of the previous date-keyed object representation.

export const CHUNK_SIZE = 10_000;
export const BYTES_PER_TIMESTEP_PER_BODY = 6 * 8; // 6 doubles

export interface ChunkBuffer {
  positions: Float64Array;
  timestamps: BigInt64Array;
  // Parallel to timestamps. Per-snapshot (E - E₀) / |E₀| from the
  // backend integrator. Stored as float32 to match the wire format —
  // it's a UI readout, the extra precision wouldn't be used.
  deltaERelative: Float32Array;
  bodyNames: string[];
  bodyNameToIndex: Map<string, number>;
  bodyCount: number;
  capacity: number;
  // Number of valid timesteps currently in the buffer. Write cursor.
  totalTimesteps: number;
  // Where the kept window starts in the session's global timestep numbering.
  // Advances by CHUNK_SIZE every eviction.
  bufferStartTimestep: number;
  // Chunk-level DP853 telemetry tracking the most-recently-appended
  // chunk. null when the active integrator is fixed-step. Latest-write-
  // wins: a fresh chunk overrides regardless of whether older chunks
  // remain in the buffer — user-facing semantics are "telemetry for the
  // latest chunk," which matches what they'd expect from a live readout.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
}

export const BUFFER_BYTE_BUDGETS = {
  lowMem: 12 * 1024 * 1024, // 12 MB — mobile / low-RAM
  default: 48 * 1024 * 1024, // 48 MB — desktop / tablet
} as const;

interface ByteBudgetEnv {
  navigator: Navigator | undefined;
  matchMedia: typeof window.matchMedia | undefined;
}

// `env` is injected so tests can drive the branches without globals.
// Default reads window/navigator if present (handles SSR + node-test env).
//
// matchMedia is bound to window — assigning `window.matchMedia` directly
// loses the `this === window` binding it requires at call time, which
// throws "Illegal invocation" in real browsers (tests pass because the
// stubs don't care about `this`).
export function selectBufferByteBudget(env?: ByteBudgetEnv): number {
  const e: ByteBudgetEnv = env ?? {
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    matchMedia:
      typeof window !== "undefined"
        ? window.matchMedia.bind(window)
        : undefined,
  };
  const dm =
    e.navigator !== undefined && "deviceMemory" in e.navigator
      ? ((e.navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? Infinity)
      : Infinity;
  const isLowMem = dm <= 4;
  const isNarrow =
    e.matchMedia !== undefined && e.matchMedia("(max-width: 767px)").matches;
  return isLowMem || isNarrow
    ? BUFFER_BYTE_BUDGETS.lowMem
    : BUFFER_BYTE_BUDGETS.default;
}

export function computeBufferCapacity(
  bodyCount: number,
  byteBudget: number,
): number {
  // Floor of one slot: a degenerate budget/body-count combination must never
  // produce a zero-capacity buffer. With appendChunk's oversized-chunk clamp,
  // capacity >= 1 guarantees forward progress (the newest sample is always
  // playable). Unreachable with the backend's 50-body cap; pure insurance.
  return Math.max(
    1,
    Math.floor(byteBudget / (bodyCount * BYTES_PER_TIMESTEP_PER_BODY)),
  );
}

// Pre-flight for preset clips: a clip decodes entirely into the buffer up
// front (no streaming, no eviction headroom), so only play it from the static
// asset when it fits well inside the client budget; callers fall back to the
// live streaming path (which evicts gracefully) otherwise. The 0.8 factor
// leaves headroom for the buffer's fixed overheads (timestamps, deltaE
// planes) and future growth. budgetBytes is injectable for tests.
export function clipFitsClientBudget(
  bodyCount: number,
  chunkCount: number,
  samplesPerChunk: number,
  budgetBytes: number = selectBufferByteBudget(),
): boolean {
  const decodedBytes =
    chunkCount * samplesPerChunk * bodyCount * BYTES_PER_TIMESTEP_PER_BODY;
  return decodedBytes <= 0.8 * budgetBytes;
}

export function createChunkBuffer(
  bodyNames: string[],
  capacity: number,
): ChunkBuffer {
  const bodyCount = bodyNames.length;
  const map = new Map<string, number>();
  for (let i = 0; i < bodyNames.length; i++) {
    map.set(bodyNames[i], i);
  }
  return {
    positions: new Float64Array(capacity * bodyCount * 6),
    timestamps: new BigInt64Array(capacity),
    deltaERelative: new Float32Array(capacity),
    bodyNames,
    bodyNameToIndex: map,
    bodyCount,
    capacity,
    totalTimesteps: 0,
    bufferStartTimestep: 0,
    dp853AvgStepSeconds: null,
    dp853AcceptRate: null,
  };
}

/**
 * Appends a chunk of timesteps to the buffer. If the new data won't fit,
 * shifts the buffer left by `chunkLen` slots to make room (evicting the
 * oldest entries) and advances `bufferStartTimestep` accordingly. If a
 * single chunk is larger than the whole buffer, evicts everything resident
 * and keeps only the newest `capacity` samples of the incoming chunk.
 * Returns the number of timesteps dropped from the global window (0 if no
 * eviction occurred); the reducer slides the playback head left by this
 * amount.
 *
 * `chunkPositions.length` must equal `chunkLen × bodyCount × 6`.
 * `chunkTimestamps.length` must equal `chunkLen`.
 */
export function appendChunk(
  buffer: ChunkBuffer,
  chunkPositions: Float64Array,
  chunkTimestamps: BigInt64Array,
  chunkDeltaE: Float32Array,
  chunkLen: number,
  dp853AvgStepSeconds: number | null = null,
  dp853AcceptRate: number | null = null,
): number {
  const stride = buffer.bodyCount * 6;

  // Oversized chunk: a single chunk bigger than the whole buffer (lowMem
  // byte budget + many bodies + a high-sample fidelity bucket). Keep only
  // the NEWEST `capacity` samples; everything resident plus the oldest
  // incoming samples are dropped. Keep-newest is load-bearing: the buffer
  // must stay a contiguous global window ending at the latest sample, or
  // the next append would leave a timestamp gap that breaks Hermite
  // interpolation at the seam. Without this branch the eviction math below
  // goes negative on the first chunk and positions.set throws RangeError.
  if (chunkLen > buffer.capacity) {
    const keep = buffer.capacity;
    const skip = chunkLen - keep;
    const dropped = buffer.totalTimesteps + skip;

    // subarray = views, no copies; each .set is one memmove.
    buffer.positions.set(
      chunkPositions.subarray(skip * stride, chunkLen * stride),
      0,
    );
    buffer.timestamps.set(chunkTimestamps.subarray(skip, chunkLen), 0);
    buffer.deltaERelative.set(chunkDeltaE.subarray(skip, chunkLen), 0);

    buffer.totalTimesteps = keep;
    buffer.bufferStartTimestep += dropped;
    buffer.dp853AvgStepSeconds = dp853AvgStepSeconds;
    buffer.dp853AcceptRate = dp853AcceptRate;
    return dropped;
  }

  let shifted = 0;

  if (buffer.totalTimesteps + chunkLen > buffer.capacity) {
    // Drop the oldest `chunkLen` timesteps. One chunk's worth of eviction
    // always makes room here: totalTimesteps <= capacity is an invariant,
    // and the oversized case (chunkLen > capacity) was handled above.
    const dropCount = chunkLen;
    const surviveCount = buffer.totalTimesteps - dropCount;

    // Shift positions, timestamps, and deltaERelative left by dropCount
    // slots in place. copyWithin is a single memmove call — fast even
    // on large arrays.
    buffer.positions.copyWithin(
      0,
      dropCount * stride,
      (dropCount + surviveCount) * stride,
    );
    buffer.timestamps.copyWithin(0, dropCount, dropCount + surviveCount);
    buffer.deltaERelative.copyWithin(0, dropCount, dropCount + surviveCount);

    buffer.totalTimesteps = surviveCount;
    buffer.bufferStartTimestep += dropCount;
    shifted = dropCount;
  }

  // Write the new chunk at the current cursor.
  buffer.positions.set(chunkPositions, buffer.totalTimesteps * stride);
  buffer.timestamps.set(chunkTimestamps, buffer.totalTimesteps);
  buffer.deltaERelative.set(chunkDeltaE, buffer.totalTimesteps);
  buffer.totalTimesteps += chunkLen;

  // Latest-write-wins: chunk telemetry tracks the freshly-appended chunk.
  buffer.dp853AvgStepSeconds = dp853AvgStepSeconds;
  buffer.dp853AcceptRate = dp853AcceptRate;

  return shifted;
}

/**
 * Per-snapshot relative energy drift. Linear interpolation between
 * keyframes (ΔE evolves slowly — cubic Hermite is overkill for a UI
 * readout that displays 1-2 sig figs). Empty buffer returns 0.
 *
 * Designed for ref-based 5 Hz polling — imperative, no allocations.
 */
export function readDeltaERelativeAt(
  buffer: ChunkBuffer,
  floatIdx: number,
): number {
  if (buffer.totalTimesteps === 0) return 0;
  if (floatIdx <= 0) return buffer.deltaERelative[0];
  if (floatIdx >= buffer.totalTimesteps - 1) {
    return buffer.deltaERelative[buffer.totalTimesteps - 1];
  }
  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;
  const a = buffer.deltaERelative[i0];
  const b = buffer.deltaERelative[i0 + 1];
  return a + (b - a) * s;
}

// Caller provides the output Vector3 — never allocates per call. Designed
// to be called inside useFrame at FPS rate.
//
// floatIdx ∈ [0, totalTimesteps - 1]. Integer values short-circuit to a
// direct typed-array read after three cheap guard comparisons — minimal
// branch overhead, preserves existing behavior for callers like Trail's
// tail loop that pass integer indices. Fractional values invoke cubic
// Hermite between floor(floatIdx) and floor(floatIdx) + 1, using the stored
// velocities as exact tangents and per-keyframe timestamps for the interval.
export function readBodyPositionInto(
  out: ThreeVector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void {
  if (floatIdx <= 0 || buffer.totalTimesteps <= 1) {
    const base = bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }
  if (floatIdx >= buffer.totalTimesteps - 1) {
    const base =
      (buffer.totalTimesteps - 1) * buffer.bodyCount * 6 + bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }

  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;

  if (s === 0) {
    const base = i0 * buffer.bodyCount * 6 + bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }

  const stride = buffer.bodyCount * 6;
  const base0 = i0 * stride + bodyIdx * 6;
  const base1 = base0 + stride;

  const dtMs = Number(buffer.timestamps[i0 + 1] - buffer.timestamps[i0]);
  const dt = dtMs / 1000;

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  const p0x = buffer.positions[base0];
  const p0y = buffer.positions[base0 + 1];
  const p0z = buffer.positions[base0 + 2];
  const v0x = buffer.positions[base0 + 3];
  const v0y = buffer.positions[base0 + 4];
  const v0z = buffer.positions[base0 + 5];
  const p1x = buffer.positions[base1];
  const p1y = buffer.positions[base1 + 1];
  const p1z = buffer.positions[base1 + 2];
  const v1x = buffer.positions[base1 + 3];
  const v1y = buffer.positions[base1 + 4];
  const v1z = buffer.positions[base1 + 5];

  out.x = h00 * p0x + h10 * dt * v0x + h01 * p1x + h11 * dt * v1x;
  out.y = h00 * p0y + h10 * dt * v0y + h01 * p1y + h11 * dt * v1y;
  out.z = h00 * p0z + h10 * dt * v0z + h01 * p1z + h11 * dt * v1z;
}

// Caller provides both output Vector3s — never allocates per call.
//
// floatIdx ∈ [0, totalTimesteps - 1]. Integer values short-circuit to
// direct typed-array reads. Fractional values perform cubic Hermite for
// position (using stored velocities as tangents) AND its analytic
// derivative for velocity. Velocity at integer keyframes equals the
// stored value exactly; velocity at fractional indices is consistent
// with the Hermite-interpolated position.
export function readBodyStateInto(
  outPos: ThreeVector3,
  outVel: ThreeVector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void {
  if (floatIdx <= 0 || buffer.totalTimesteps <= 1) {
    const base = bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }
  if (floatIdx >= buffer.totalTimesteps - 1) {
    const base =
      (buffer.totalTimesteps - 1) * buffer.bodyCount * 6 + bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }

  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;

  if (s === 0) {
    const base = i0 * buffer.bodyCount * 6 + bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }

  const stride = buffer.bodyCount * 6;
  const base0 = i0 * stride + bodyIdx * 6;
  const base1 = base0 + stride;

  const dtMs = Number(buffer.timestamps[i0 + 1] - buffer.timestamps[i0]);
  const dt = dtMs / 1000;

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
  const invDt = 1 / dt;

  const p0x = buffer.positions[base0];
  const p0y = buffer.positions[base0 + 1];
  const p0z = buffer.positions[base0 + 2];
  const v0x = buffer.positions[base0 + 3];
  const v0y = buffer.positions[base0 + 4];
  const v0z = buffer.positions[base0 + 5];
  const p1x = buffer.positions[base1];
  const p1y = buffer.positions[base1 + 1];
  const p1z = buffer.positions[base1 + 2];
  const v1x = buffer.positions[base1 + 3];
  const v1y = buffer.positions[base1 + 4];
  const v1z = buffer.positions[base1 + 5];

  outPos.x = h00 * p0x + h10 * dt * v0x + h01 * p1x + h11 * dt * v1x;
  outPos.y = h00 * p0y + h10 * dt * v0y + h01 * p1y + h11 * dt * v1y;
  outPos.z = h00 * p0z + h10 * dt * v0z + h01 * p1z + h11 * dt * v1z;

  outVel.x = (dh00 * p0x + dh01 * p1x) * invDt + dh10 * v0x + dh11 * v1x;
  outVel.y = (dh00 * p0y + dh01 * p1y) * invDt + dh10 * v0y + dh11 * v1y;
  outVel.z = (dh00 * p0z + dh01 * p1z) * invDt + dh10 * v0z + dh11 * v1z;
}

export function getTimestamp(buffer: ChunkBuffer, timestepIdx: number): bigint {
  return buffer.timestamps[timestepIdx];
}

export function getTimestampAsIsoString(
  buffer: ChunkBuffer,
  timestepIdx: number,
): string {
  // Floor the index so float values from Phase 1's wall-clock-rate animation
  // driving land on a real keyframe slot. BigInt64Array indexed with a
  // fractional key returns undefined → Number(undefined) = NaN →
  // new Date(NaN).toISOString() throws RangeError. Semantically: "the
  // timestamp at or before this fractional position" — same reasoning as
  // Trail's tail loop ("integer indexing is semantically correct for
  // historical keyframe reads").
  const idx = Math.floor(timestepIdx);
  if (idx < 0 || idx >= buffer.totalTimesteps) return "";
  const millis = Number(buffer.timestamps[idx]);
  return new Date(millis).toISOString();
}
