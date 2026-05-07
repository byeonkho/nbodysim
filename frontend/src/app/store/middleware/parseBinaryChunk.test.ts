import { describe, expect, it } from "vitest";
import { parseBinaryChunk } from "./parseBinaryChunk";

// Helper: build a chunk-format byte array matching the spec in
// parseBinaryChunk.ts (and BinaryResponseSerializer.java). This duplicates the
// backend serializer in JS so the round-trip test below proves our parser
// agrees with the documented format. Backend has its own test pinning the
// same layout from the Java side; if either side drifts, one test fails first.
function buildChunkBytes(
  bodyNames: string[],
  timesteps: Array<{
    millis: number;
    bodies: Array<{ pos: [number, number, number]; vel: [number, number, number] }>;
  }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const encodedNames = bodyNames.map((n) => encoder.encode(n));
  const headerSize =
    2 +
    encodedNames.reduce((sum, b) => sum + 2 + b.length, 0) +
    4;
  const perTimestep = 8 + bodyNames.length * 6 * 8;
  const total = headerSize + timesteps.length * perTimestep;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let offset = 0;

  view.setUint16(offset, bodyNames.length, true);
  offset += 2;
  for (const name of encodedNames) {
    view.setUint16(offset, name.length, true);
    offset += 2;
    out.set(name, offset);
    offset += name.length;
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
      ["Earth", "Moon"],
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
    expect(Object.keys(result)).toEqual([key]);
    expect(result[key]).toEqual([
      { name: "Earth", position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } },
      { name: "Moon", position: { x: 7, y: 8, z: 9 }, velocity: { x: 10, y: 11, z: 12 } },
    ]);
  });

  it("preserves multi-byte UTF-8 in body names", () => {
    // "Α" (Greek capital alpha) is 2 bytes in UTF-8; nameLength counts bytes,
    // not characters. Catches the off-by-one if we accidentally use char count.
    const bytes = buildChunkBytes(
      ["Α"],
      [
        {
          millis: 0,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
    );

    const result = parseBinaryChunk(bytes);
    const key = "1970-01-01T00:00:00.000Z";
    expect(result[key][0].name).toBe("Α");
  });

  it("handles multiple timesteps in header order", () => {
    const bytes = buildChunkBytes(
      ["A", "B"],
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
    expect(result["1970-01-01T00:00:01.000Z"][0].position.x).toBe(1);
    expect(result["1970-01-01T00:00:02.000Z"][1].position.x).toBe(4);
  });
});
