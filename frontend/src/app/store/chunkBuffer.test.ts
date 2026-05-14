import { describe, expect, it } from "vitest";
import {
  createChunkBuffer,
  CHUNK_SIZE,
  computeBufferCapacity,
  selectBufferByteBudget,
  BUFFER_BYTE_BUDGETS,
} from "./chunkBuffer";

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
