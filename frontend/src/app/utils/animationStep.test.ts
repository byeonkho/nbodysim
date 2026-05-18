import { describe, expect, it } from "vitest";
import { computeNextIndex } from "./animationStep";

describe("computeNextIndex", () => {
  it("at speedMultiplier=1, FPS=60, delta=1/60s → moves 1 unit forward", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: 1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(101, 10);
  });

  it("at speedMultiplier=2, doubles the step rate", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: 2,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(102, 10);
  });

  it("negative speedMultiplier moves backward", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: -1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(99, 10);
  });

  it("clamps to upper bound at totalTimesteps - 1", () => {
    const next = computeNextIndex({
      currentIndex: 9_999.5,
      delta: 1 / 60,
      speedMultiplier: 100,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBe(9_999);
  });

  it("clamps to lower bound at 0", () => {
    const next = computeNextIndex({
      currentIndex: 0.5,
      delta: 1 / 60,
      speedMultiplier: -100,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBe(0);
  });

  it("returns fractional values for sub-frame motion", () => {
    // At 144Hz with speedMultiplier=1, delta ≈ 1/144, expected step ≈ 60/144 ≈ 0.417
    const next = computeNextIndex({
      currentIndex: 0,
      delta: 1 / 144,
      speedMultiplier: 1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(60 / 144, 6);
  });
});
