import { describe, expect, it } from "vitest";
import {
  createChunkBuffer,
  CHUNK_SIZE,
  computeBufferCapacity,
  selectBufferByteBudget,
  BUFFER_BYTE_BUDGETS,
  appendChunk,
  readBodyPositionInto,
  readBodyStateInto,
  getTimestamp,
  getTimestampAsIsoString,
} from "./chunkBuffer";
import * as THREE from "three";

function makeChunkPositions(
  bodyCount: number,
  timestepCount: number,
  startValue = 0,
): Float64Array {
  const arr = new Float64Array(bodyCount * timestepCount * 6);
  for (let i = 0; i < arr.length; i++) arr[i] = startValue + i;
  return arr;
}

function makeChunkTimestamps(
  timestepCount: number,
  startMillis: bigint = BigInt(0),
): BigInt64Array {
  const arr = new BigInt64Array(timestepCount);
  for (let i = 0; i < timestepCount; i++) arr[i] = startMillis + BigInt(i);
  return arr;
}

describe("createChunkBuffer", () => {
  it("allocates positions and timestamps sized for the given capacity", () => {
    const buf = createChunkBuffer(["Earth", "Moon"], 1000);
    expect(buf.bodyCount).toBe(2);
    expect(buf.bodyNames).toEqual(["Earth", "Moon"]);
    expect(buf.bodyNameToIndex.get("Earth")).toBe(0);
    expect(buf.bodyNameToIndex.get("Moon")).toBe(1);
    expect(buf.positions.length).toBe(1000 * 2 * 6);
    expect(buf.timestamps.length).toBe(1000);
    expect(buf.totalTimesteps).toBe(0);
    expect(buf.bufferStartTimestep).toBe(0);
    expect(buf.capacity).toBe(1000);
  });

  it("exports CHUNK_SIZE", () => {
    expect(CHUNK_SIZE).toBe(10_000);
  });
});

describe("selectBufferByteBudget", () => {
  it("returns lowMem budget when viewport is narrow", () => {
    const fakeMatchMedia = (q: string) => ({
      matches: q.includes("max-width: 767px"),
    });
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: fakeMatchMedia as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns lowMem budget when deviceMemory ≤ 4", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 4 } as unknown as Navigator,
      matchMedia: (() => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns default budget when neither low-mem signal applies", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 8 } as unknown as Navigator,
      matchMedia: (() => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });

  it("returns default budget when navigator/matchMedia are absent (SSR)", () => {
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: undefined,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });
});

describe("computeBufferCapacity", () => {
  it("derives capacity from byte budget and body count", () => {
    // 12 MB / (9 bodies × 48 bytes) = 27,962 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.lowMem)).toBe(29_127);
    // 48 MB / (9 bodies × 48 bytes) = 116,508 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.default)).toBe(116_508);
  });

  it("scales inversely with body count", () => {
    expect(computeBufferCapacity(3, BUFFER_BYTE_BUDGETS.default)).toBeGreaterThan(
      computeBufferCapacity(12, BUFFER_BYTE_BUDGETS.default),
    );
  });
});

describe("appendChunk", () => {
  it("appends to a fresh buffer without eviction", () => {
    const buf = createChunkBuffer(["A", "B"], 100);
    const positions = makeChunkPositions(2, 10);
    const timestamps = makeChunkTimestamps(10);
    appendChunk(buf, positions, timestamps, 10);

    expect(buf.totalTimesteps).toBe(10);
    expect(buf.bufferStartTimestep).toBe(0);
    // First slot of first body
    expect(buf.positions[0]).toBe(0);
    // Last slot of last body of timestep 9
    expect(buf.positions[10 * 2 * 6 - 1]).toBe(positions[positions.length - 1]);
    expect(buf.timestamps[9]).toBe(BigInt(9));
  });

  it("evicts oldest timesteps in chunk-sized blocks when capacity is exceeded", () => {
    // Capacity 30 = 3 × chunk-of-10. Fourth chunk forces eviction.
    const buf = createChunkBuffer(["A"], 30);
    appendChunk(buf, makeChunkPositions(1, 10, 0), makeChunkTimestamps(10, BigInt(0)), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 100), makeChunkTimestamps(10, BigInt(100)), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 200), makeChunkTimestamps(10, BigInt(200)), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(0);

    // Fourth chunk forces eviction of the first 10 timesteps.
    appendChunk(buf, makeChunkPositions(1, 10, 300), makeChunkTimestamps(10, BigInt(300)), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(10);

    // First valid timestep is now what was originally timestep 10 (value 100).
    expect(buf.timestamps[0]).toBe(BigInt(100));
    expect(buf.positions[0]).toBe(100);
    // Last valid timestep is the freshly-appended one (300+59).
    expect(buf.timestamps[29]).toBe(BigInt(309));
  });

  it("returns the number of timesteps shifted (0 if no eviction)", () => {
    const buf = createChunkBuffer(["A"], 30);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), 10),
    ).toBe(10);
  });
});

describe("readBodyPositionInto", () => {
  it("reads px/py/pz into the provided Vector3 (no allocation)", () => {
    const buf = createChunkBuffer(["A", "B"], 10);
    // Timestep 2, body 1: write known values into the slot.
    const base = 2 * 2 * 6 + 1 * 6;
    buf.positions[base + 0] = 100;
    buf.positions[base + 1] = 200;
    buf.positions[base + 2] = 300;
    buf.positions[base + 3] = 0.1; // vx — should be ignored
    buf.totalTimesteps = 3;

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 2, 1);
    expect(out.x).toBe(100);
    expect(out.y).toBe(200);
    expect(out.z).toBe(300);
  });
});

describe("readBodyStateInto", () => {
  it("reads position AND velocity into two provided Vector3s", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.positions[0] = 1;
    buf.positions[1] = 2;
    buf.positions[2] = 3;
    buf.positions[3] = 4;
    buf.positions[4] = 5;
    buf.positions[5] = 6;
    buf.totalTimesteps = 1;

    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    readBodyStateInto(pos, vel, buf, 0, 0);
    expect([pos.x, pos.y, pos.z]).toEqual([1, 2, 3]);
    expect([vel.x, vel.y, vel.z]).toEqual([4, 5, 6]);
  });
});

describe("readBodyPositionInto — integer index (regression)", () => {
  it("returns stored position exactly at integer keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);

    readBodyPositionInto(out, buf, 1, 0);
    expect(out.x).toBe(4);
    expect(out.y).toBe(5);
    expect(out.z).toBe(6);
  });
});

describe("readBodyStateInto — integer index (regression)", () => {
  it("returns stored position and velocity exactly at integer keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 1, 0);
    expect(outPos.x).toBe(4);
    expect(outPos.y).toBe(5);
    expect(outPos.z).toBe(6);
    expect(outVel.x).toBe(13);
    expect(outVel.y).toBe(14);
    expect(outVel.z).toBe(15);
  });
});

describe("getTimestamp / getTimestampAsIsoString", () => {
  it("returns raw millis as BigInt and ISO string for a given timestep", () => {
    const buf = createChunkBuffer(["A"], 5);
    const millis = BigInt(Date.UTC(2024, 5, 5));
    buf.timestamps[0] = millis;
    buf.totalTimesteps = 1;

    expect(getTimestamp(buf, 0)).toBe(millis);
    expect(getTimestampAsIsoString(buf, 0)).toBe("2024-06-05T00:00:00.000Z");
  });

  it("returns empty string for out-of-range indices", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.totalTimesteps = 0;
    expect(getTimestampAsIsoString(buf, 0)).toBe("");
    expect(getTimestampAsIsoString(buf, -1)).toBe("");
    expect(getTimestampAsIsoString(buf, 5)).toBe("");
  });
});
