import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  appendChunk,
  createChunkBuffer,
  readBodyPositionInto,
} from "./chunkBuffer";
import {
  readExactReferenceInto,
  readReferencePositionInto,
} from "./referencePosition";

describe("reference positions", () => {
  it("compares the combined system and invalidates on properties, focus and session changes", () => {
    const buffer = createChunkBuffer(["PLUTO", "CHARON", "EARTH"], 2);
    buffer.totalTimesteps = 2;
    buffer.timestamps.set([0, 1000]);
    buffer.positions[0] = 100;
    buffer.positions[6] = 120;
    buffer.positions[12] = 900;
    const props = [
      { name: "PLUTO", mu: 9, referenceBodyNames: ["PLUTO", "CHARON"] },
      { name: "CHARON", mu: 1 },
      { name: "EARTH", mu: 5 },
    ];
    const out = new Vector3();
    expect(readReferencePositionInto(out, buffer, 0, "PLUTO", props)).toBe(
      true,
    );
    expect(out.x).toBe(102);
    readReferencePositionInto(out, buffer, 0, "EARTH", props);
    expect(out.x).toBe(900);
    readReferencePositionInto(out, buffer, 0, "PLUTO", [
      { name: "PLUTO", mu: 10 },
    ]);
    expect(out.x).toBe(100);
    const other = createChunkBuffer(["CHARON", "PLUTO"], 2);
    other.totalTimesteps = 2;
    other.timestamps.set([0, 1000]);
    other.positions[0] = 30;
    other.positions[6] = 10;
    readReferencePositionInto(out, other, 0, "PLUTO", props);
    expect(out.x).toBe(12);
  });

  it("never turns sparse interpolation or endpoint clamping into a numeric measurement", () => {
    const anchors = [
      { epochMillis: 0, position: [1, 2, 3], velocity: [0, 0, 0] },
      { epochMillis: 1000, position: [10, 20, 30], velocity: [0, 0, 0] },
    ];
    const out = new Vector3();
    for (const epoch of [-1, 500, 1001])
      expect(readExactReferenceInto(out, anchors, epoch)).toBe(false);
    expect(readExactReferenceInto(out, anchors, 1000)).toBe(true);
    expect(out.toArray()).toEqual([10, 20, 30]);
  });
});

it("preserves continuous sample keys through normal and oversized eviction", () => {
  const buffer = createChunkBuffer(["EARTH"], 4);
  const add = (keys: number[]) =>
    appendChunk(
      buffer,
      new Float64Array(keys.length * 6),
      new Float64Array(keys.map((k) => k + 1000)),
      new Float32Array(keys.length),
      keys.length,
      null,
      null,
      new Float64Array(keys),
    );
  add([0, 1, 2]);
  add([3, 4]);
  expect([
    ...buffer.referenceEpochs!.subarray(0, buffer.totalTimesteps),
  ]).toEqual([2, 3, 4]);
  add([5, 6, 7, 8, 9, 10]);
  expect([...buffer.referenceEpochs!]).toEqual([7, 8, 9, 10]);
});

it("uses continuous time for interpolation when UTC display times alias", () => {
  const buffer = createChunkBuffer(["EARTH"], 2);
  buffer.totalTimesteps = 2;
  buffer.timestamps.set([1000, 1000]);
  buffer.referenceEpochs = new Float64Array([0, 1000]);
  buffer.positions[3] = 4;
  const out = new Vector3();
  readBodyPositionInto(out, buffer, 0.5, 0);
  expect(out.x).toBe(0.5);
});
