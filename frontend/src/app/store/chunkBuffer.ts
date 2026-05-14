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
