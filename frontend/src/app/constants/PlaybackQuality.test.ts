import { describe, expect, it } from "vitest";
import {
  PLAYBACK_QUALITY_PRESETS,
  INTEGRATOR_QUALITY_DEFAULTS,
  getActivePresetKey,
  stepDtSeconds,
  parseCustomMultiplier,
  MAX_QUALITY_MULTIPLIER,
  type PlaybackQualityKey,
} from "./PlaybackQuality";

describe("PLAYBACK_QUALITY_PRESETS", () => {
  it("has the 5 expected keys ordered low → high quality (left → right in the picker), with monotonically decreasing multipliers", () => {
    const keys = Object.keys(PLAYBACK_QUALITY_PRESETS) as PlaybackQualityKey[];
    expect(keys).toEqual(["low", "medLow", "medium", "medHigh", "high"]);
    const multipliers = keys.map((k) => PLAYBACK_QUALITY_PRESETS[k].multiplier);
    expect(multipliers).toEqual([16, 8, 4, 2, 1]);
  });

  it("every preset has a non-empty label", () => {
    for (const preset of Object.values(PLAYBACK_QUALITY_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });
});

describe("INTEGRATOR_QUALITY_DEFAULTS", () => {
  it("every integrator default is a valid preset key", () => {
    const presetKeys = new Set(Object.keys(PLAYBACK_QUALITY_PRESETS));
    for (const presetKey of Object.values(INTEGRATOR_QUALITY_DEFAULTS)) {
      expect(presetKeys.has(presetKey)).toBe(true);
    }
  });

  it("covers the three integrators the form exposes", () => {
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("euler");
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("rk4");
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("dp853");
  });
});

describe("getActivePresetKey", () => {
  it("returns the matching preset key when multiplier equals a preset", () => {
    expect(getActivePresetKey(1)).toBe("high");
    expect(getActivePresetKey(2)).toBe("medHigh");
    expect(getActivePresetKey(4)).toBe("medium");
    expect(getActivePresetKey(8)).toBe("medLow");
    expect(getActivePresetKey(16)).toBe("low");
  });

  it("returns null when multiplier doesn't match any preset (custom value)", () => {
    expect(getActivePresetKey(3)).toBeNull();
    expect(getActivePresetKey(5)).toBeNull();
    expect(getActivePresetKey(100)).toBeNull();
  });
});

describe("stepDtSeconds", () => {
  it("returns 1.0 for seconds", () => {
    expect(stepDtSeconds("Seconds")).toBe(1);
  });

  it("returns 3600 for hours", () => {
    expect(stepDtSeconds("Hours")).toBe(3600);
  });

  it("returns 86400 for days", () => {
    expect(stepDtSeconds("Days")).toBe(86400);
  });

  it("returns 604800 for weeks", () => {
    expect(stepDtSeconds("Weeks")).toBe(7 * 86400);
  });

  it("is case-insensitive", () => {
    expect(stepDtSeconds("seconds")).toBe(1);
    expect(stepDtSeconds("HOURS")).toBe(3600);
  });

  it("throws on unknown unit", () => {
    expect(() => stepDtSeconds("Fortnights")).toThrow();
  });
});

describe("MAX_QUALITY_MULTIPLIER", () => {
  it("matches the backend's MAX_KEYFRAMES_PER_KEPT", () => {
    expect(MAX_QUALITY_MULTIPLIER).toBe(100);
  });
});

describe("parseCustomMultiplier", () => {
  it("accepts integer strings in range [1, 100]", () => {
    expect(parseCustomMultiplier("1")).toEqual({ value: 1, error: null });
    expect(parseCustomMultiplier("50")).toEqual({ value: 50, error: null });
    expect(parseCustomMultiplier("100")).toEqual({ value: 100, error: null });
  });

  it("returns error for 0", () => {
    const result = parseCustomMultiplier("0");
    expect(result.value).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("returns error for negative", () => {
    expect(parseCustomMultiplier("-5").value).toBeNull();
  });

  it("returns error for above max", () => {
    expect(parseCustomMultiplier("101").value).toBeNull();
    expect(parseCustomMultiplier("999").value).toBeNull();
  });

  it("returns error for non-integer", () => {
    expect(parseCustomMultiplier("3.5").value).toBeNull();
    expect(parseCustomMultiplier("abc").value).toBeNull();
  });

  it("returns error for empty string", () => {
    expect(parseCustomMultiplier("").value).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseCustomMultiplier("  4  ")).toEqual({ value: 4, error: null });
  });
});
