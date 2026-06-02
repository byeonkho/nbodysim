import { describe, expect, it } from "vitest";
import { parseBinaryChunk, parseBinaryChunkToTypedArrays } from "./parseBinaryChunk";

// Helper: build a chunk-format byte array matching the spec in
// parseBinaryChunk.ts (and BinaryResponseSerializer.java). This duplicates the
// backend serializer in JS so the round-trip test below proves our parser
// agrees with the documented format (version 2: delta-encoded, structure-of-
// arrays). Backend has its own test pinning the same layout from the Java
// side; if either side drifts, one test fails first.
//
// Fixtures use uniformly-spaced timesteps, so (start, gap) reconstructs each
// timestamp exactly; and small-integer positions/deltas round-trip exactly
// through float32.
const WIRE_FORMAT_VERSION = 2;

function buildChunkBytes(
  bodies: Array<{ name: string; mu: number }>,
  timesteps: Array<{
    millis: number;
    deltaERelative: number;
    bodies: Array<{ pos: [number, number, number]; vel: [number, number, number] }>;
  }>,
  dp853AvgStepSeconds: number = Number.NaN,
  dp853AcceptRate: number = Number.NaN,
): Uint8Array {
  const encoder = new TextEncoder();
  const encodedNames = bodies.map((b) => encoder.encode(b.name));
  const B = bodies.length;
  const T = timesteps.length;

  const headerSize =
    1 + // formatVersion (uint8)
    2 + // bodyCount
    encodedNames.reduce((sum, b) => sum + 2 + b.length + 8, 0) +
    8 + // dp853AvgStepSeconds (float64)
    4 + // dp853AcceptRate (float32)
    4;  // timestepCount
  const bodySection =
    T === 0
      ? 0
      : 8 + // startMillis
        8 + // gapMillis
        T * 4 + // deltaERelative planar
        B * 3 * 8 + // per-body f64 reference
        T * B * 3 * 4 + // f32 position deltas (planar)
        T * B * 3 * 4; // f32 velocity (planar)
  const total = headerSize + bodySection;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let offset = 0;

  view.setUint8(offset, WIRE_FORMAT_VERSION);
  offset += 1;
  view.setUint16(offset, B, true);
  offset += 2;
  for (let i = 0; i < B; i++) {
    const nameBytes = encodedNames[i];
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;
    out.set(nameBytes, offset);
    offset += nameBytes.length;
    view.setFloat64(offset, bodies[i].mu, true);
    offset += 8;
  }
  view.setFloat64(offset, dp853AvgStepSeconds, true);
  offset += 8;
  view.setFloat32(offset, dp853AcceptRate, true);
  offset += 4;
  view.setUint32(offset, T, true);
  offset += 4;

  if (T === 0) return out;

  const start = timesteps[0].millis;
  const gap = T > 1 ? (timesteps[T - 1].millis - start) / (T - 1) : 0;
  view.setBigInt64(offset, BigInt(start), true);
  offset += 8;
  view.setFloat64(offset, gap, true);
  offset += 8;

  // deltaERelative (planar).
  for (let t = 0; t < T; t++) {
    view.setFloat32(offset, timesteps[t].deltaERelative, true);
    offset += 4;
  }

  // Per-body absolute reference (timestep 0).
  for (let b = 0; b < B; b++) {
    view.setFloat64(offset, timesteps[0].bodies[b].pos[0], true); offset += 8;
    view.setFloat64(offset, timesteps[0].bodies[b].pos[1], true); offset += 8;
    view.setFloat64(offset, timesteps[0].bodies[b].pos[2], true); offset += 8;
  }

  // Per-step position deltas, planar by axis (row 0 = 0).
  for (let axis = 0; axis < 3; axis++) {
    for (let t = 0; t < T; t++) {
      for (let b = 0; b < B; b++) {
        const d =
          t === 0
            ? 0
            : timesteps[t].bodies[b].pos[axis] -
              timesteps[t - 1].bodies[b].pos[axis];
        view.setFloat32(offset, d, true);
        offset += 4;
      }
    }
  }

  // Velocity, planar by axis, absolute float32.
  for (let axis = 0; axis < 3; axis++) {
    for (let t = 0; t < T; t++) {
      for (let b = 0; b < B; b++) {
        view.setFloat32(offset, timesteps[t].bodies[b].vel[axis], true);
        offset += 4;
      }
    }
  }

  return out;
}

describe("parseBinaryChunk", () => {
  it("parses a known byte layout into the expected structure", () => {
    const bytes = buildChunkBytes(
      [
        { name: "Earth", mu: 3.986004418e14 },
        { name: "Moon", mu: 4.9028000661e12 },
      ],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          deltaERelative: 0,
          bodies: [
            { pos: [1, 2, 3], vel: [4, 5, 6] },
            { pos: [7, 8, 9], vel: [10, 11, 12] },
          ],
        },
      ],
    );

    const result = parseBinaryChunk(bytes);

    const key = "2024-06-05T00:00:00.000Z";
    expect(Object.keys(result.data)).toEqual([key]);
    expect(result.data[key]).toEqual([
      { name: "Earth", position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } },
      { name: "Moon", position: { x: 7, y: 8, z: 9 }, velocity: { x: 10, y: 11, z: 12 } },
    ]);
    expect(result.mu).toEqual({
      Earth: 3.986004418e14,
      Moon: 4.9028000661e12,
    });
  });

  it("preserves multi-byte UTF-8 in body names", () => {
    // "Α" (Greek capital alpha) is 2 bytes in UTF-8; nameLength counts bytes,
    // not characters. Catches the off-by-one if we accidentally use char count.
    const bytes = buildChunkBytes(
      [{ name: "Α", mu: 1 }],
      [
        {
          millis: 0,
          deltaERelative: 0,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
    );

    const result = parseBinaryChunk(bytes);
    const key = "1970-01-01T00:00:00.000Z";
    expect(result.data[key][0].name).toBe("Α");
    expect(result.mu["Α"]).toBe(1);
  });

  it("handles multiple timesteps in header order", () => {
    const bytes = buildChunkBytes(
      [
        { name: "A", mu: 100 },
        { name: "B", mu: 200 },
      ],
      [
        {
          millis: 1000,
          deltaERelative: 0,
          bodies: [
            { pos: [1, 0, 0], vel: [0, 0, 0] },
            { pos: [2, 0, 0], vel: [0, 0, 0] },
          ],
        },
        {
          millis: 2000,
          deltaERelative: 0,
          bodies: [
            { pos: [3, 0, 0], vel: [0, 0, 0] },
            { pos: [4, 0, 0], vel: [0, 0, 0] },
          ],
        },
      ],
    );

    const result = parseBinaryChunk(bytes);
    expect(result.data["1970-01-01T00:00:01.000Z"][0].position.x).toBe(1);
    expect(result.data["1970-01-01T00:00:02.000Z"][1].position.x).toBe(4);
    expect(result.mu).toEqual({ A: 100, B: 200 });
  });

  it("parses DP853 telemetry + per-snapshot ΔE/E₀ at the canonical fixture", () => {
    // Same fixture values as backend BinaryResponseSerializerTest's
    // serialisesNewIntegratorResidualFields — if either side drifts,
    // one of the two tests fails first.
    const bytes = buildChunkBytes(
      [
        { name: "Earth", mu: 3.986004418e14 },
        { name: "Moon", mu: 4.9028000661e12 },
      ],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          deltaERelative: 1.5e-12,
          bodies: [
            { pos: [1, 2, 3], vel: [4, 5, 6] },
            { pos: [7, 8, 9], vel: [10, 11, 12] },
          ],
        },
      ],
      3600.0,
      0.94,
    );

    const result = parseBinaryChunk(bytes);
    expect(result.dp853AvgStepSeconds).toBeCloseTo(3600.0, 6);
    expect(result.dp853AcceptRate).toBeCloseTo(0.94, 5);

    const key = "2024-06-05T00:00:00.000Z";
    expect(result.deltaERelative[key]).toBeCloseTo(1.5e-12, 18);
  });

  it("maps NaN dp853 telemetry to null", () => {
    const bytes = buildChunkBytes(
      [{ name: "Earth", mu: 3.986004418e14 }],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          deltaERelative: 0,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
      Number.NaN,
      Number.NaN,
    );
    const result = parseBinaryChunk(bytes);
    expect(result.dp853AvgStepSeconds).toBeNull();
    expect(result.dp853AcceptRate).toBeNull();
  });

  it("propagates µ=0 for backend missing-entry fallback", () => {
    // Backend writes 0.0 when the µ map is missing an entry. Parser surfaces
    // it as-is — downstream Keplerian-element code treats µ=0 as "unknown"
    // and skips that body's elements rather than producing NaN.
    const bytes = buildChunkBytes(
      [{ name: "Earth", mu: 0 }],
      [
        {
          millis: 0,
          deltaERelative: 0,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
    );

    const result = parseBinaryChunk(bytes);
    expect(result.mu.Earth).toBe(0);
  });
});

describe("parseBinaryChunkToTypedArrays", () => {
  it("decodes the same wire format into typed arrays in row-major layout", () => {
    const bytes = buildChunkBytes(
      [
        { name: "Earth", mu: 3.986004418e14 },
        { name: "Moon", mu: 4.9028000661e12 },
      ],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          deltaERelative: 0,
          bodies: [
            { pos: [1, 2, 3], vel: [4, 5, 6] },
            { pos: [7, 8, 9], vel: [10, 11, 12] },
          ],
        },
        {
          millis: Date.UTC(2024, 5, 6),
          deltaERelative: 0,
          bodies: [
            { pos: [13, 14, 15], vel: [16, 17, 18] },
            { pos: [19, 20, 21], vel: [22, 23, 24] },
          ],
        },
      ],
    );

    const result = parseBinaryChunkToTypedArrays(bytes);
    expect(result.bodyNames).toEqual(["Earth", "Moon"]);
    expect(result.bodyCount).toBe(2);
    expect(result.timestepCount).toBe(2);
    expect(result.mu).toEqual({
      Earth: 3.986004418e14,
      Moon: 4.9028000661e12,
    });
    expect(result.timestamps.length).toBe(2);
    expect(result.timestamps[0]).toBe(BigInt(Date.UTC(2024, 5, 5)));
    expect(result.timestamps[1]).toBe(BigInt(Date.UTC(2024, 5, 6)));

    // Layout: positions[t * bodyCount * 6 + b * 6 + c]
    expect(Array.from(result.positions.slice(0, 6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(result.positions.slice(6, 12))).toEqual([7, 8, 9, 10, 11, 12]);
    expect(Array.from(result.positions.slice(12, 18))).toEqual([13, 14, 15, 16, 17, 18]);
    expect(Array.from(result.positions.slice(18, 24))).toEqual([19, 20, 21, 22, 23, 24]);
  });

  it("parses DP853 telemetry + deltaERelative typed array", () => {
    const bytes = buildChunkBytes(
      [{ name: "Earth", mu: 3.986004418e14 }],
      [
        {
          millis: 1000,
          deltaERelative: 1e-12,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
        {
          millis: 2000,
          deltaERelative: 2e-12,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
      7200.0,
      0.97,
    );
    const result = parseBinaryChunkToTypedArrays(bytes);
    expect(result.dp853AvgStepSeconds).toBeCloseTo(7200.0, 6);
    expect(result.dp853AcceptRate).toBeCloseTo(0.97, 5);
    expect(result.deltaERelative.length).toBe(2);
    expect(result.deltaERelative[0]).toBeCloseTo(1e-12, 18);
    expect(result.deltaERelative[1]).toBeCloseTo(2e-12, 18);
  });
});
