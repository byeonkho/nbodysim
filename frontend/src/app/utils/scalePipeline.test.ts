import { describe, it, expect, beforeEach } from "vitest";
import {
  worldDistance,
  worldRadius,
  REALISTIC_DIVISOR,
  DEFAULT_LOG_SCALE_A,
} from "./scalePipeline";
import { setDevSetting } from "@/app/dev/devSettingsStore";

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
