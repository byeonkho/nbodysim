import { describe, expect, it } from "vitest";
import {
  createChunkBuffer,
  CHUNK_SIZE,
  computeBufferCapacity,
  selectBufferByteBudget,
  BUFFER_BYTE_BUDGETS,
  appendChunk,
} from "./chunkBuffer";

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
  startMillis = 0n,
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
      matchMedia: ((_q: string) => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns default budget when neither low-mem signal applies", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 8 } as unknown as Navigator,
      matchMedia: ((_q: string) => ({ matches: false })) as unknown as typeof window.matchMedia,
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
    expect(buf.timestamps[9]).toBe(9n);
  });

  it("evicts oldest timesteps in chunk-sized blocks when capacity is exceeded", () => {
    // Capacity 30 = 3 × chunk-of-10. Fourth chunk forces eviction.
    const buf = createChunkBuffer(["A"], 30);
    appendChunk(buf, makeChunkPositions(1, 10, 0), makeChunkTimestamps(10, 0n), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 100), makeChunkTimestamps(10, 100n), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 200), makeChunkTimestamps(10, 200n), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(0);

    // Fourth chunk forces eviction of the first 10 timesteps.
    appendChunk(buf, makeChunkPositions(1, 10, 300), makeChunkTimestamps(10, 300n), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(10);

    // First valid timestep is now what was originally timestep 10 (value 100).
    expect(buf.timestamps[0]).toBe(100n);
    expect(buf.positions[0]).toBe(100);
    // Last valid timestep is the freshly-appended one (300+59).
    expect(buf.timestamps[29]).toBe(309n);
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
