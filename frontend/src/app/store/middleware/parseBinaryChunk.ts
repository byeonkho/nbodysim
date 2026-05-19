// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format (after zstd, all little-endian):
//   uint16   bodyCount
//   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
//   float64  dp853AvgStepSeconds       (NaN if not DP853)
//   float32  dp853AcceptRate           (NaN if not DP853)
//   uint32   timestepCount
//   per timestep:
//     int64    timestamp (millis since UNIX epoch, UTC)
//     float32  deltaERelative          (E - E₀) / |E₀| at this snapshot
//     per body (header order):
//       float64 × 3   (px, py, pz)   — position
//       float32 × 3   (vx, vy, vz)   — velocity
//
// Mixed precision: positions are rendered directly (per-pixel sensitivity
// to quantization) so they need float64. Velocities are inputs to
// downstream math (Hermite tangent → position over one gap-interval;
// Keplerian v² → semi-major axis) that damps precision loss by ~5 orders
// of magnitude — float32 is fine for them. Per-snapshot ΔE/E₀ is also
// float32: it's a UI readout displayed as 1-2 sig figs, the extra
// precision wouldn't be used.
//
// `mu` is the standard gravitational parameter (G·M, m³/s²) for each body —
// constant per session, sent once with names. Used client-side to derive
// Keplerian orbital elements from (r, v) state vectors. µ=0 means "unknown"
// (backend missing-entry fallback) and downstream code skips Keplerian
// rendering for that body rather than producing NaN cascades.
//
// DP853 telemetry fields are NaN-encoded for fixed-step chunks; the parser
// maps NaN → null for cleaner downstream handling than threading NaN checks
// through every consumer.

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
  // Per-snapshot relative energy drift, keyed by the same ISO strings as `data`.
  deltaERelative: Record<string, number>;
  // null when the chunk was produced by a fixed-step integrator.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
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

  const dp853AvgRaw = view.getFloat64(offset, true);
  offset += 8;
  const dp853RateRaw = view.getFloat32(offset, true);
  offset += 4;
  const dp853AvgStepSeconds = Number.isNaN(dp853AvgRaw) ? null : dp853AvgRaw;
  const dp853AcceptRate = Number.isNaN(dp853RateRaw) ? null : dp853RateRaw;

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const data: Record<string, CelestialBody[]> = {};
  const deltaERelative: Record<string, number> = {};
  for (let t = 0; t < timestepCount; t++) {
    const millis = Number(view.getBigInt64(offset, true));
    offset += 8;
    const isoKey = new Date(millis).toISOString();
    deltaERelative[isoKey] = view.getFloat32(offset, true);
    offset += 4;

    const snapshot: CelestialBody[] = new Array(bodyCount);
    for (let b = 0; b < bodyCount; b++) {
      const px = view.getFloat64(offset, true); offset += 8;
      const py = view.getFloat64(offset, true); offset += 8;
      const pz = view.getFloat64(offset, true); offset += 8;
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

  return { data, mu, deltaERelative, dp853AvgStepSeconds, dp853AcceptRate };
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
  // Length = timestepCount. Per-snapshot (E - E₀) / |E₀| from the backend.
  deltaERelative: Float32Array;
  // null when the chunk was produced by a fixed-step integrator.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
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

  const dp853AvgRaw = view.getFloat64(offset, true);
  offset += 8;
  const dp853RateRaw = view.getFloat32(offset, true);
  offset += 4;
  const dp853AvgStepSeconds = Number.isNaN(dp853AvgRaw) ? null : dp853AvgRaw;
  const dp853AcceptRate = Number.isNaN(dp853RateRaw) ? null : dp853RateRaw;

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float64Array(timestepCount * bodyCount * 6);
  const timestamps = new BigInt64Array(timestepCount);
  const deltaERelative = new Float32Array(timestepCount);

  for (let t = 0; t < timestepCount; t++) {
    timestamps[t] = view.getBigInt64(offset, true);
    offset += 8;
    deltaERelative[t] = view.getFloat32(offset, true);
    offset += 4;
    const tBase = t * bodyCount * 6;
    for (let b = 0; b < bodyCount; b++) {
      const slotBase = tBase + b * 6;
      positions[slotBase + 0] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 1] = view.getFloat64(offset, true); offset += 8;
      positions[slotBase + 2] = view.getFloat64(offset, true); offset += 8;
      // Velocities widen on assignment into the Float64Array slot.
      positions[slotBase + 3] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 4] = view.getFloat32(offset, true); offset += 4;
      positions[slotBase + 5] = view.getFloat32(offset, true); offset += 4;
    }
  }

  return {
    bodyNames, bodyCount, timestepCount, positions, timestamps, mu,
    deltaERelative, dp853AvgStepSeconds, dp853AcceptRate,
  };
}
