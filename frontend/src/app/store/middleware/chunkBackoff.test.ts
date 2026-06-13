import { describe, it, expect } from "vitest";
import { computeBackoffMs, MAX_CHUNK_RETRY_ATTEMPTS } from "./chunkBackoff";

describe("computeBackoffMs", () => {
  it("doubles each attempt starting at 1s", () => {
    expect(computeBackoffMs(0)).toBe(1000);
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
  });
  it("caps at 30s", () => {
    expect(computeBackoffMs(10)).toBe(30_000);
  });
  it("clamps a negative attempt to the base", () => {
    expect(computeBackoffMs(-5)).toBe(1000);
  });
  it("has a small finite attempt budget", () => {
    expect(MAX_CHUNK_RETRY_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_CHUNK_RETRY_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
