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
  bodyNames: readonly string[];
  bodyNameToIndex: ReadonlyMap<string, number>;
  bodyCount: number;
  capacity: number;
  // Number of valid timesteps currently in the buffer. Write cursor.
  totalTimesteps: number;
  // Where the kept window starts in the session's global timestep numbering.
  // Advances by CHUNK_SIZE every eviction.
  bufferStartTimestep: number;
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
export function selectBufferByteBudget(env?: ByteBudgetEnv): number {
  const e: ByteBudgetEnv = env ?? {
    navigator: typeof navigator !== "undefined" ? navigator : undefined,
    matchMedia: typeof window !== "undefined" ? window.matchMedia : undefined,
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
  return Math.floor(byteBudget / (bodyCount * BYTES_PER_TIMESTEP_PER_BODY));
}

export function createChunkBuffer(
  bodyNames: readonly string[],
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
    bodyNames,
    bodyNameToIndex: map,
    bodyCount,
    capacity,
    totalTimesteps: 0,
    bufferStartTimestep: 0,
  };
}

/**
 * Appends a chunk of timesteps to the buffer. If the new data won't fit,
 * shifts the buffer left by `chunkLen` slots to make room (evicting the
 * oldest entries) and advances `bufferStartTimestep` accordingly. Returns
 * the number of timesteps shifted (0 if no eviction occurred).
 *
 * `chunkPositions.length` must equal `chunkLen × bodyCount × 6`.
 * `chunkTimestamps.length` must equal `chunkLen`.
 */
export function appendChunk(
  buffer: ChunkBuffer,
  chunkPositions: Float64Array,
  chunkTimestamps: BigInt64Array,
  chunkLen: number,
): number {
  const stride = buffer.bodyCount * 6;
  let shifted = 0;

  if (buffer.totalTimesteps + chunkLen > buffer.capacity) {
    // Drop the oldest `chunkLen` timesteps. Assumes chunks are uniformly
    // sized so a single chunk's worth of eviction always makes room.
    const dropCount = chunkLen;
    const surviveCount = buffer.totalTimesteps - dropCount;

    // Shift positions and timestamps left by dropCount slots in place.
    // copyWithin is a single memmove call — fast even on large arrays.
    buffer.positions.copyWithin(
      0,
      dropCount * stride,
      (dropCount + surviveCount) * stride,
    );
    buffer.timestamps.copyWithin(0, dropCount, dropCount + surviveCount);

    buffer.totalTimesteps = surviveCount;
    buffer.bufferStartTimestep += dropCount;
    shifted = dropCount;
  }

  // Write the new chunk at the current cursor.
  buffer.positions.set(chunkPositions, buffer.totalTimesteps * stride);
  buffer.timestamps.set(chunkTimestamps, buffer.totalTimesteps);
  buffer.totalTimesteps += chunkLen;

  return shifted;
}
