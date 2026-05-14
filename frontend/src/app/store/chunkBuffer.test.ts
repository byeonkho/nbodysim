import { describe, expect, it } from "vitest";
import { createChunkBuffer, CHUNK_SIZE } from "./chunkBuffer";

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
