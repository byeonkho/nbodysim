// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format (after zstd, all little-endian):
//   uint16   bodyCount
//   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
//   uint32   timestepCount
//   per timestep:
//     int64    timestamp (millis since UNIX epoch, UTC)
//     per body (header order):
//       float32 × 6   (px, py, pz, vx, vy, vz)
//
// Positions + velocities use float32 — ~7-decimal-digit precision is fine
// for visualisation and halves the per-timestep wire size. Decoded into the
// existing Float64Array buffer via implicit widening; downstream consumers
// (Sphere, Trail, etc.) see no shape change.
//
// `mu` is the standard gravitational parameter (G·M, m³/s²) for each body —
// constant per session, sent once with names. Stays float64 because µ
// appears once per session per body (not per timestep) and the Keplerian
// derivation is sensitive to µ precision. Used client-side to derive
// Keplerian orbital elements from (r, v) state vectors. µ=0 means "unknown"
// (backend missing-entry fallback) and downstream code skips Keplerian
// rendering for that body rather than producing NaN cascades.

export interface CelestialBody {
  name: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

export interface ParsedChunk {
  // Per-timestep snapshots keyed by ISO-8601 UTC string.
  data: Record<string, CelestialBody[]>;
  // Per-body µ (m³/s²) keyed by body name as written in the header.
  mu: Record<string, number>;
}

const utf8Decoder = new TextDecoder("utf-8");

export function parseBinaryChunk(bytes: Uint8Array): ParsedChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const bodyCount = view.getUint16(offset, true);
  offset += 2;

  const names: string[] = new Array(bodyCount);
  const mu: Record<string, number> = {};
  for (let i = 0; i < bodyCount; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const nameBytes = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset + offset,
      nameLen,
    );
    const name = utf8Decoder.decode(nameBytes);
    names[i] = name;
    offset += nameLen;
    mu[name] = view.getFloat64(offset, true);
    offset += 8;
  }

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const data: Record<string, CelestialBody[]> = {};
  for (let t = 0; t < timestepCount; t++) {
    const millis = Number(view.getBigInt64(offset, true));
    offset += 8;
    const isoKey = new Date(millis).toISOString();

    const snapshot: CelestialBody[] = new Array(bodyCount);
    for (let b = 0; b < bodyCount; b++) {
      const px = view.getFloat32(offset, true); offset += 4;
      const py = view.getFloat32(offset, true); offset += 4;
      const pz = view.getFloat32(offset, true); offset += 4;
      const vx = view.getFloat32(offset, true); offset += 4;
      const vy = view.getFloat32(offset, true); offset += 4;
      const vz = view.getFloat32(offset, true); offset += 4;
      snapshot[b] = {
        name: names[b],
        position: { x: px, y: py, z: pz },
        velocity: { x: vx, y: vy, z: vz },
      };
    }
    data[isoKey] = snapshot;
  }

  return { data, mu };
}

export interface ParsedChunkTypedArrays {
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  // Length = timestepCount × bodyCount × 6.
  // Layout: positions[t * bodyCount * 6 + b * 6 + c]
  // components: 0=px 1=py 2=pz 3=vx 4=vy 5=vz
  positions: Float64Array;
  // Length = timestepCount. Millis since UNIX epoch.
  timestamps: BigInt64Array;
  // Per-body µ (m³/s²) keyed by body name.
  mu: Record<string, number>;
}

export function parseBinaryChunkToTypedArrays(
  bytes: Uint8Array,
): ParsedChunkTypedArrays {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const bodyCount = view.getUint16(offset, true);
  offset += 2;

  const bodyNames: string[] = new Array(bodyCount);
  const mu: Record<string, number> = {};
  for (let i = 0; i < bodyCount; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const nameBytes = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset + offset,
      nameLen,
    );
    const name = utf8Decoder.decode(nameBytes);
    bodyNames[i] = name;
    offset += nameLen;
    mu[name] = view.getFloat64(offset, true);
    offset += 8;
  }

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float64Array(timestepCount * bodyCount * 6);
  const timestamps = new BigInt64Array(timestepCount);

  for (let t = 0; t < timestepCount; t++) {
    timestamps[t] = view.getBigInt64(offset, true);
    offset += 8;
    const tBase = t * bodyCount * 6;
    for (let b = 0; b < bodyCount; b++) {
      const slotBase = tBase + b * 6;
      // Float32 reads widen to float64 on assignment into the Float64Array slot.
      positions[slotBase + 0] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 1] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 2] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 3] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 4] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 5] = view.getFloat32(offset, true); offset += 4;
    }
  }

  return { bodyNames, bodyCount, timestepCount, positions, timestamps, mu };
}
