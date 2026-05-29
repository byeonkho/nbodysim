import { describe, it, expect } from "vitest";
import {
  masterState,
  matchesPreset,
  MOONS_BY_PARENT,
  SECTION_MEMBERS,
  PRESETS,
  DEFAULT_SELECTED,
} from "./BodyCatalog";
import type { BodyKey } from "./BodyVisuals";

const set = (...keys: BodyKey[]) => new Set<BodyKey>(keys);

describe("masterState", () => {
  it("returns 'off' when none selected", () => {
    expect(masterState(["SUN", "EARTH"], set())).toBe("off");
  });
  it("returns 'on' when all selected", () => {
    expect(masterState(["SUN", "EARTH"], set("SUN", "EARTH"))).toBe("on");
  });
  it("returns 'mixed' when some selected", () => {
    expect(masterState(["SUN", "EARTH"], set("SUN"))).toBe("mixed");
  });
  it("treats empty key list as 'off'", () => {
    expect(masterState([], set())).toBe("off");
  });
});

describe("matchesPreset", () => {
  it("matches a preset when the selection equals its key set exactly", () => {
    const full = PRESETS.find((p) => p.id === "full")!;
    expect(matchesPreset(full, new Set(full.keys))).toBe(true);
  });
  it("does not match when selection is a strict subset", () => {
    const full = PRESETS.find((p) => p.id === "full")!;
    const subset = new Set(full.keys.slice(0, full.keys.length - 1));
    expect(matchesPreset(full, subset)).toBe(false);
  });
  it("does not match when selection has an extra key", () => {
    const inner = PRESETS.find((p) => p.id === "inner")!;
    expect(matchesPreset(inner, new Set([...inner.keys, "PLUTO"]))).toBe(false);
  });
});

describe("catalog data", () => {
  it("groups 22 moons across parents", () => {
    const total = Object.values(MOONS_BY_PARENT).reduce(
      (n, arr) => n + arr.length,
      0,
    );
    expect(total).toBe(22);
  });
  it("counts Charon under the dwarfPlanet section (via parent Pluto)", () => {
    expect(SECTION_MEMBERS.dwarfPlanet).toContain("CHARON");
  });
  it("default selection is Sun + 8 planets + Moon (10)", () => {
    expect(DEFAULT_SELECTED).toHaveLength(10);
    expect(DEFAULT_SELECTED).toContain("MOON");
  });
});
