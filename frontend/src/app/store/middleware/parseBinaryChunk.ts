// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format version 2 (after zstd, all little-endian):
//   uint8    formatVersion (= 2)
//   uint16   bodyCount (B)
//   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
//   float64  dp853AvgStepSeconds       (NaN if not DP853)
//   float32  dp853AcceptRate           (NaN if not DP853)
//   uint32   timestepCount (T)
//   — present only when T > 0 —
//   int64    startMillis               (timestamp of timestep 0, millis UTC)
//   float64  gapMillis                 (uniform spacing; ts[i] = round(start + i*gap))
//   float32  deltaERelative[T]         (planar)
//   per body: float64 refX, refY, refZ (absolute position at timestep 0)
//   float32  dPx[T*B], dPy[T*B], dPz[T*B]   (per-step position deltas, planar; row 0 = 0)
//   float32  vx[T*B], vy[T*B], vz[T*B]      (absolute velocity, planar)
//
// Positions are delta-encoded: a per-body float64 reference (timestep 0) plus
// per-step float32 deltas. We reconstruct absolute positions by prefix sum in
// float64 (JS numbers are float64), so the worst-case accumulated error stays
// the sub-km drift the backend measured — invisible, and not the per-sample
// jitter that ruled out absolute float32. Each chunk has its own reference, so
// the error never crosses chunk seams.
//
// Timestamps are reconstructed from (start, gap) by rounding — accurate to
// ~1 ms, invisible in the date readout and the Hermite interval.
//
// Velocities stay float32 (Hermite tangent client-side; not the bandwidth
// target). Per-snapshot ΔE/E₀ is float32: a UI readout shown to 1-2 sig figs.
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

export const WIRE_FORMAT_VERSION = 2;

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

const utf8Decoder = new TextDecoder("utf-8");

// Reads the version + header (names, µ, DP853 telemetry, timestep count) and
// returns where the body section begins. Shared by both parse entry points.
interface ParsedHeader {
  bodyNames: string[];
  mu: Record<string, number>;
  bodyCount: number;
  timestepCount: number;
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
  offset: number;
}

function parseHeader(view: DataView, bytes: Uint8Array): ParsedHeader {
  let offset = 0;

  const version = view.getUint8(offset);
  offset += 1;
  if (version !== WIRE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported chunk wire format version ${version} (expected ${WIRE_FORMAT_VERSION})`,
    );
  }

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

  return {
    bodyNames,
    mu,
    bodyCount,
    timestepCount,
    dp853AvgStepSeconds,
    dp853AcceptRate,
    offset,
  };
}

export function parseBinaryChunkToTypedArrays(
  bytes: Uint8Array,
): ParsedChunkTypedArrays {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = parseHeader(view, bytes);
  const { bodyNames, mu, bodyCount, timestepCount } = header;
  let offset = header.offset;

  const positions = new Float64Array(timestepCount * bodyCount * 6);
  const timestamps = new BigInt64Array(timestepCount);
  const deltaERelative = new Float32Array(timestepCount);

  if (timestepCount === 0) {
    return {
      bodyNames, bodyCount, timestepCount, positions, timestamps, mu,
      deltaERelative,
      dp853AvgStepSeconds: header.dp853AvgStepSeconds,
      dp853AcceptRate: header.dp853AcceptRate,
    };
  }

  const startMillis = Number(view.getBigInt64(offset, true));
  offset += 8;
  const gapMillis = view.getFloat64(offset, true);
  offset += 8;

  // deltaERelative (planar).
  for (let t = 0; t < timestepCount; t++) {
    deltaERelative[t] = view.getFloat32(offset, true);
    offset += 4;
  }

  // Per-body absolute reference (timestep 0). Seed the running accumulators.
  const accX = new Float64Array(bodyCount);
  const accY = new Float64Array(bodyCount);
  const accZ = new Float64Array(bodyCount);
  for (let b = 0; b < bodyCount; b++) {
    accX[b] = view.getFloat64(offset, true); offset += 8;
    accY[b] = view.getFloat64(offset, true); offset += 8;
    accZ[b] = view.getFloat64(offset, true); offset += 8;
  }

  // Position deltas, planar by axis (row 0 = 0). Reconstruct absolute
  // positions by prefix sum in float64 and scatter into the interleaved layout.
  reconstructAxis(view, offset, accX, timestepCount, bodyCount, positions, 0);
  offset += timestepCount * bodyCount * 4;
  reconstructAxis(view, offset, accY, timestepCount, bodyCount, positions, 1);
  offset += timestepCount * bodyCount * 4;
  reconstructAxis(view, offset, accZ, timestepCount, bodyCount, positions, 2);
  offset += timestepCount * bodyCount * 4;

  // Velocity, planar by axis, absolute float32 — widens into the f64 slot.
  offset = readVelocityAxis(view, offset, timestepCount, bodyCount, positions, 3);
  offset = readVelocityAxis(view, offset, timestepCount, bodyCount, positions, 4);
  offset = readVelocityAxis(view, offset, timestepCount, bodyCount, positions, 5);

  // Timestamps from (start, gap) — round to nearest ms.
  for (let t = 0; t < timestepCount; t++) {
    timestamps[t] = BigInt(Math.round(startMillis + t * gapMillis));
  }

  return {
    bodyNames, bodyCount, timestepCount, positions, timestamps, mu,
    deltaERelative,
    dp853AvgStepSeconds: header.dp853AvgStepSeconds,
    dp853AcceptRate: header.dp853AcceptRate,
  };
}

// Prefix-sums one axis of per-step deltas onto the seeded accumulator and
// writes each result into the interleaved positions array at component `comp`.
function reconstructAxis(
  view: DataView,
  startOffset: number,
  acc: Float64Array,
  timestepCount: number,
  bodyCount: number,
  positions: Float64Array,
  comp: number,
): void {
  let offset = startOffset;
  const stride = bodyCount * 6;
  for (let t = 0; t < timestepCount; t++) {
    const tBase = t * stride;
    for (let b = 0; b < bodyCount; b++) {
      acc[b] += view.getFloat32(offset, true); // row 0 delta is 0
      offset += 4;
      positions[tBase + b * 6 + comp] = acc[b];
    }
  }
}

function readVelocityAxis(
  view: DataView,
  startOffset: number,
  timestepCount: number,
  bodyCount: number,
  positions: Float64Array,
  comp: number,
): number {
  let offset = startOffset;
  const stride = bodyCount * 6;
  for (let t = 0; t < timestepCount; t++) {
    const tBase = t * stride;
    for (let b = 0; b < bodyCount; b++) {
      positions[tBase + b * 6 + comp] = view.getFloat32(offset, true);
      offset += 4;
    }
  }
  return offset;
}

// Object-keyed view of a chunk. Thin adapter over the typed-array parser so the
// wire format has a single source of truth. Kept for tests / debugging; the
// production decode path uses parseBinaryChunkToTypedArrays directly.
export function parseBinaryChunk(bytes: Uint8Array): ParsedChunk {
  const ta = parseBinaryChunkToTypedArrays(bytes);
  const data: Record<string, CelestialBody[]> = {};
  const deltaERelative: Record<string, number> = {};
  const stride = ta.bodyCount * 6;
  for (let t = 0; t < ta.timestepCount; t++) {
    const isoKey = new Date(Number(ta.timestamps[t])).toISOString();
    deltaERelative[isoKey] = ta.deltaERelative[t];
    const snapshot: CelestialBody[] = new Array(ta.bodyCount);
    const tBase = t * stride;
    for (let b = 0; b < ta.bodyCount; b++) {
      const base = tBase + b * 6;
      snapshot[b] = {
        name: ta.bodyNames[b],
        position: {
          x: ta.positions[base],
          y: ta.positions[base + 1],
          z: ta.positions[base + 2],
        },
        velocity: {
          x: ta.positions[base + 3],
          y: ta.positions[base + 4],
          z: ta.positions[base + 5],
        },
      };
    }
    data[isoKey] = snapshot;
  }
  return {
    data,
    mu: ta.mu,
    deltaERelative,
    dp853AvgStepSeconds: ta.dp853AvgStepSeconds,
    dp853AcceptRate: ta.dp853AcceptRate,
  };
}
