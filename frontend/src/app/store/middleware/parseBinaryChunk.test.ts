import { describe, expect, it } from "vitest";
import { parseBinaryChunk, parseBinaryChunkToTypedArrays } from "./parseBinaryChunk";

// Helper: build a chunk-format byte array matching the spec in
// parseBinaryChunk.ts (and BinaryResponseSerializer.java). This duplicates the
// backend serializer in JS so the round-trip test below proves our parser
// agrees with the documented format. Backend has its own test pinning the
// same layout from the Java side; if either side drifts, one test fails first.
function buildChunkBytes(
  bodies: Array<{ name: string; mu: number }>,
  timesteps: Array<{
    millis: number;
    bodies: Array<{ pos: [number, number, number]; vel: [number, number, number] }>;
  }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const encodedNames = bodies.map((b) => encoder.encode(b.name));
  const headerSize =
    2 +
    // Each body: 2 (nameLen) + name bytes + 8 (µ).
    encodedNames.reduce((sum, b) => sum + 2 + b.length + 8, 0) +
    4;
  const perTimestep = 8 + bodies.length * 6 * 8;
  const total = headerSize + timesteps.length * perTimestep;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let offset = 0;

  view.setUint16(offset, bodies.length, true);
  offset += 2;
  for (let i = 0; i < bodies.length; i++) {
    const nameBytes = encodedNames[i];
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;
    out.set(nameBytes, offset);
    offset += nameBytes.length;
    view.setFloat64(offset, bodies[i].mu, true);
    offset += 8;
  }
  view.setUint32(offset, timesteps.length, true);
  offset += 4;

  for (const t of timesteps) {
    view.setBigInt64(offset, BigInt(t.millis), true);
    offset += 8;
    for (const body of t.bodies) {
      view.setFloat64(offset, body.pos[0], true); offset += 8;
      view.setFloat64(offset, body.pos[1], true); offset += 8;
      view.setFloat64(offset, body.pos[2], true); offset += 8;
      view.setFloat64(offset, body.vel[0], true); offset += 8;
      view.setFloat64(offset, body.vel[1], true); offset += 8;
      view.setFloat64(offset, body.vel[2], true); offset += 8;
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
          bodies: [
            { pos: [1, 0, 0], vel: [0, 0, 0] },
            { pos: [2, 0, 0], vel: [0, 0, 0] },
          ],
        },
        {
          millis: 2000,
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

  it("propagates µ=0 for backend missing-entry fallback", () => {
    // Backend writes 0.0 when the µ map is missing an entry. Parser surfaces
    // it as-is — downstream Keplerian-element code treats µ=0 as "unknown"
    // and skips that body's elements rather than producing NaN.
    const bytes = buildChunkBytes(
      [{ name: "Earth", mu: 0 }],
      [
        {
          millis: 0,
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
          bodies: [
            { pos: [1, 2, 3], vel: [4, 5, 6] },
            { pos: [7, 8, 9], vel: [10, 11, 12] },
          ],
        },
        {
          millis: Date.UTC(2024, 5, 6),
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
});
