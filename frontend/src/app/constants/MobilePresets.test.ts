import { describe, it, expect } from "vitest";
import { MOBILE_PRESETS, DEFAULT_PRESET_ID } from "./MobilePresets";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";

describe("MOBILE_PRESETS", () => {
  it("has exactly the three designed presets", () => {
    expect(MOBILE_PRESETS.map((p) => p.id)).toEqual([
      "full-system",
      "inner-planets",
      "earth-moon",
    ]);
  });

  it("the default preset id exists and is full-system", () => {
    expect(DEFAULT_PRESET_ID).toBe("full-system");
    expect(MOBILE_PRESETS.some((p) => p.id === DEFAULT_PRESET_ID)).toBe(true);
  });

  it("every preset has a non-empty body list of known body keys", () => {
    for (const p of MOBILE_PRESETS) {
      expect(p.keys.length).toBeGreaterThan(0);
      for (const k of p.keys) {
        expect(BODY_DISPLAY[k]).toBeTypeOf("string");
      }
    }
  });

  it("earth-moon includes Earth and Moon", () => {
    const em = MOBILE_PRESETS.find((p) => p.id === "earth-moon");
    expect(em?.keys).toContain("EARTH");
    expect(em?.keys).toContain("MOON");
  });
});
