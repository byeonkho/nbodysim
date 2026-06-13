// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format version 3 (after zstd, all little-endian):
//   uint8    formatVersion (= 3)
//   uint16   bodyCount (B)
//   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
//   float64  dp853AvgStepSeconds       (NaN if not DP853)
//   float32  dp853AcceptRate           (NaN if not DP853)
//   uint32   timestepCount (T)
//   — present only when T > 0 —
//   int64    startMillis               (timestamp of timestep 0, millis UTC)
//   float64  gapMillis                 (uniform spacing; ts[i] = round(start + i*gap))
//   float32  deltaERelative[T]         (planar, UNSHUFFLED)
//   per body: float64 refX, refY, refZ (absolute position at timestep 0, UNSHUFFLED)
//   SHUFFLED float32 dPx[T*B]          (per-step position deltas, planar; row 0 = 0)
//   SHUFFLED float32 dPy[T*B]
//   SHUFFLED float32 dPz[T*B]
//   SHUFFLED float32 vx[T*B]           (velocity temporal-delta: row 0 absolute, rows 1..T-1 = step deltas)
//   SHUFFLED float32 vy[T*B]
//   SHUFFLED float32 vz[T*B]
//
// "SHUFFLED float32 plane of N values": byte p (0..3) of value i is at offset
// p*N + i within the plane region. To un-shuffle: gather the 4 bytes at
// p*N + i back into value i's natural little-endian order, reinterpret as float32.
//
// Positions are delta-encoded: a per-body float64 reference (timestep 0) plus
// per-step float32 deltas. We reconstruct absolute positions by prefix sum in
// float64 (JS numbers are float64), so the worst-case accumulated error stays
// the sub-km drift the backend measured — invisible, and not the per-sample
// jitter that ruled out absolute float32. Each chunk has its own reference, so
// the error never crosses chunk seams.
//
// Velocities are temporal-delta encoded: row 0 holds the absolute value, rows
// 1..T-1 hold per-step deltas. Reconstruction is a prefix sum seeded from 0
// (0 + absolute = absolute for row 0; later rows add deltas). Worst-case
// accumulated error is ~0.02 m/s — invisible in the Hermite tangent at the
// zoom levels this project uses.
//
// Timestamps are reconstructed from (start, gap) by rounding — accurate to
// ~1 ms, invisible in the date readout and the Hermite interval.
//
// Per-snapshot ΔE/E₀ is float32: a UI readout shown to 1-2 sig figs.
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

export const WIRE_FORMAT_VERSION = 3;

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

// Un-shuffle one byte-plane-shuffled float32 plane of `n` values starting at
// `offset` (relative to the chunk start, i.e. an index into `bytes`). The four
// byte-planes are contiguous, so we view each as a subarray and pack them back
// into native little-endian float32 words. Host is little-endian (every browser
// target), matching the wire; the same assumption the prior code made via
// `new Float32Array(buffer)`.
function unshufflePlane(bytes: Uint8Array, offset: number, n: number): Float32Array {
  const words = new Uint32Array(n);
  const p0 = bytes.subarray(offset, offset + n);
  const p1 = bytes.subarray(offset + n, offset + 2 * n);
  const p2 = bytes.subarray(offset + 2 * n, offset + 3 * n);
  const p3 = bytes.subarray(offset + 3 * n, offset + 4 * n);
  for (let i = 0; i < n; i++) {
    words[i] = (p0[i] | (p1[i] << 8) | (p2[i] << 16) | (p3[i] << 24)) >>> 0;
  }
  return new Float32Array(words.buffer);
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

  // Guard: ensure the buffer is large enough for every byte the parser will
  // touch. Without this check, unshufflePlane reads via Uint8Array.subarray,
  // which clamps silently -- a short buffer produces zeros rather than an error,
  // making truncated/corrupt assets appear as bodies frozen at the reference
  // position with zero velocity.
  //
  // Required layout when T > 0:
  //   header.offset          end of the header region
  //   + 16                   startMillis (int64, 8) + gapMillis (f64, 8)
  //   + T * 4                deltaERelative plane (one f32 per timestep)
  //   + B * 24               per-body f64 reference (3 x f64 = 24 bytes each)
  //   + 6 * T * B * 4        six shuffled f32 planes (pos x/y/z + vel x/y/z)
  const requiredBytes =
    offset + 16 + timestepCount * 4 + bodyCount * 24 + 6 * timestepCount * bodyCount * 4;
  if (bytes.byteLength < requiredBytes) {
    throw new RangeError(
      `Binary chunk is truncated: expected at least ${requiredBytes} bytes, got ${bytes.byteLength}`,
    );
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

  const planeLen = timestepCount * bodyCount;

  // Positions: un-shuffle each axis plane, prefix-sum onto the f64 reference.
  for (let comp = 0; comp < 3; comp++) {
    const acc = comp === 0 ? accX : comp === 1 ? accY : accZ;
    const plane = unshufflePlane(bytes, offset, planeLen);
    offset += planeLen * 4;
    const stride = bodyCount * 6;
    for (let t = 0; t < timestepCount; t++) {
      const tBase = t * stride;
      const pBase = t * bodyCount;
      for (let b = 0; b < bodyCount; b++) {
        acc[b] += plane[pBase + b];               // row 0 delta is 0
        positions[tBase + b * 6 + comp] = acc[b];
      }
    }
  }

  // Velocity: un-shuffle, prefix-sum from 0 (row 0 holds the absolute value).
  const vacc = new Float64Array(bodyCount);
  for (let comp = 3; comp < 6; comp++) {
    vacc.fill(0);
    const plane = unshufflePlane(bytes, offset, planeLen);
    offset += planeLen * 4;
    const stride = bodyCount * 6;
    for (let t = 0; t < timestepCount; t++) {
      const tBase = t * stride;
      const pBase = t * bodyCount;
      for (let b = 0; b < bodyCount; b++) {
        vacc[b] += plane[pBase + b];               // row 0 = absolute
        positions[tBase + b * 6 + comp] = vacc[b];
      }
    }
  }

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
