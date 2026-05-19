import { describe, it, expect, beforeEach } from "vitest";
import {
  worldDistance,
  worldRadius,
  worldDistanceFromParent,
  REALISTIC_DIVISOR,
  DEFAULT_LOG_SCALE_A,
} from "./scalePipeline";
import { setDevSetting } from "@/app/dev/devSettingsStore";
import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

describe("worldDistance", () => {
  beforeEach(() => {
    // Reset log params to defaults so tests are deterministic.
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
  });

  describe("realistic preset", () => {
    it("returns 0 for r=0", () => {
      expect(worldDistance(0, "realistic")).toBe(0);
    });

    it("divides by REALISTIC_DIVISOR for arbitrary r", () => {
      expect(worldDistance(1e8, "realistic")).toBe(1);
      expect(worldDistance(5e10, "realistic")).toBe(500);
    });

    it("is monotonic", () => {
      const r1 = worldDistance(1e10, "realistic");
      const r2 = worldDistance(2e10, "realistic");
      expect(r2).toBeGreaterThan(r1);
    });
  });

  describe("log preset", () => {
    const AU = 149_597_870_700;

    it("returns 0 for r=0 (log1p property)", () => {
      expect(worldDistance(0, "log")).toBe(0);
    });

    it("places Earth (1 AU) at A * log10(2) ≈ 18.06 wu", () => {
      const expected = DEFAULT_LOG_SCALE_A * Math.log10(2);
      expect(worldDistance(AU, "log")).toBeCloseTo(expected, 5);
    });

    it("places Neptune (30 AU) at A * log10(31) ≈ 89.5 wu", () => {
      const expected = DEFAULT_LOG_SCALE_A * Math.log10(31);
      expect(worldDistance(30 * AU, "log")).toBeCloseTo(expected, 5);
    });

    it("is monotonic", () => {
      const r1 = worldDistance(0.5 * AU, "log");
      const r2 = worldDistance(1.0 * AU, "log");
      const r3 = worldDistance(30 * AU, "log");
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });

    it("responds to live param changes", () => {
      const before = worldDistance(AU, "log");
      setDevSetting("logScaleA", 120); // double A
      const after = worldDistance(AU, "log");
      expect(after).toBeCloseTo(before * 2, 5);
    });
  });
});

describe("worldRadius", () => {
  beforeEach(() => {
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
  });

  describe("realistic preset", () => {
    it("divides by REALISTIC_DIVISOR with no floor", () => {
      // Earth radius 6.371e6 m → 0.06371 wu (below 0.5 floor — but no floor in realistic)
      expect(worldRadius(6.371e6, "realistic")).toBeCloseTo(0.06371, 5);
      // Sun radius 6.96e8 m → 6.96 wu
      expect(worldRadius(6.96e8, "realistic")).toBeCloseTo(6.96, 5);
    });

    it("returns 0 for R=0", () => {
      expect(worldRadius(0, "realistic")).toBe(0);
    });
  });

  describe("log preset", () => {
    it("clamps small bodies to logRadiusFloor", () => {
      // Earth (6.371e6 m / 1e8 = 0.064 wu) is below 0.5 floor → clamped
      expect(worldRadius(6.371e6, "log")).toBe(0.5);
      // Mercury (2.44e6 m / 1e8 = 0.024 wu) likewise
      expect(worldRadius(2.44e6, "log")).toBe(0.5);
    });

    it("passes through for bodies above the floor", () => {
      // Sun (6.96e8 m / 1e8 = 6.96 wu) is well above 0.5 floor
      expect(worldRadius(6.96e8, "log")).toBeCloseTo(6.96, 5);
    });

    it("responds to floor changes", () => {
      setDevSetting("logRadiusFloor", 1.0);
      expect(worldRadius(6.371e6, "log")).toBe(1.0);
    });
  });
});

describe("worldDistanceFromParent", () => {
  const AU = 149_597_870_700;
  let out: Vector3Simple;

  beforeEach(() => {
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
    out = { x: 0, y: 0, z: 0 };
  });

  it("passes through when child is comfortably outside parent", () => {
    // Earth at 1 AU from Sun, log preset. Sun world radius ~7 wu,
    // Earth world radius 0.5 (floor). Threshold = 7 + 0.5 + 1.0 = 8.5.
    // Earth's worldDistance(1 AU) = ~18 wu > 8.5 → pass through.
    const childPos = { x: AU, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 7.0, 0.5, "log", out);
    // Magnitude should equal worldDistance(AU, "log")
    const expectedMag = DEFAULT_LOG_SCALE_A * Math.log10(2);
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(expectedMag, 5);
  });

  it("enforces minimum separation when child would merge with parent", () => {
    // Moon at ~3.84e8 m from Earth, log preset. Earth world radius 0.5,
    // Moon world radius 0.5. Threshold = 0.5 + 0.5 + 1.0 = 2.0.
    // Moon's worldDistance(3.84e8) = 60 * log10(1 + 3.84e8/1.5e11) ≈ 0.067 wu
    // Below threshold → clamp to 2.0 wu.
    const moonR = 3.84e8;
    const childPos = { x: moonR, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 0.5, 0.5, "log", out);
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(2.0, 5);
  });

  it("preserves direction when clamping", () => {
    // Pure-Y offset child; result should also be along Y.
    const childPos = { x: 0, y: 3.84e8, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 0.5, 0.5, "log", out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
    expect(out.y).toBeGreaterThan(0);
  });

  it("returns zero vector when child overlaps parent exactly", () => {
    // Degenerate case: identical positions. Should not NaN.
    const samePos = { x: 1e10, y: 0, z: 0 };
    worldDistanceFromParent(samePos, samePos, 0.5, 0.5, "log", out);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("works in realistic preset too", () => {
    // Earth at 1 AU from Sun, realistic preset. worldDistance(AU) = 1496 wu,
    // way above any threshold → pass through.
    const childPos = { x: AU, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 6.96, 0.064, "realistic", out);
    const expectedMag = AU / REALISTIC_DIVISOR;
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(expectedMag, 1);
  });
});
