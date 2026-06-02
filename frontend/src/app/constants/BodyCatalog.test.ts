import { describe, it, expect } from "vitest";
import {
  masterState,
  matchesPreset,
  MOONS_BY_PARENT,
  SECTION_MEMBERS,
  PRESETS,
  DEFAULT_SELECTED,
  focusedMoonSystemParent,
  isGatedMoonParent,
  shouldShowMoonDetail,
  isMoonParentCollapsed,
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

describe("focusedMoonSystemParent", () => {
  it("maps a focused moon to its parent", () => {
    expect(focusedMoonSystemParent("EUROPA")).toBe("JUPITER");
    expect(focusedMoonSystemParent("CHARON")).toBe("PLUTO");
    expect(focusedMoonSystemParent("MOON")).toBe("EARTH");
  });
  it("maps a focused moon-parent to itself", () => {
    expect(focusedMoonSystemParent("JUPITER")).toBe("JUPITER");
    expect(focusedMoonSystemParent("SATURN")).toBe("SATURN");
    expect(focusedMoonSystemParent("MARS")).toBe("MARS");
    expect(focusedMoonSystemParent("EARTH")).toBe("EARTH");
  });
  it("returns null for the Sun, moonless planets, asteroids, and null", () => {
    expect(focusedMoonSystemParent("SUN")).toBeNull();
    expect(focusedMoonSystemParent("VENUS")).toBeNull();
    expect(focusedMoonSystemParent("MERCURY")).toBeNull();
    expect(focusedMoonSystemParent("EROS")).toBeNull();
    expect(focusedMoonSystemParent(null)).toBeNull();
  });
});

describe("isGatedMoonParent", () => {
  it("is true for the gated moon parents", () => {
    for (const p of ["MARS", "JUPITER", "SATURN", "URANUS", "NEPTUNE", "PLUTO"]) {
      expect(isGatedMoonParent(p)).toBe(true);
    }
  });
  it("is false for the exempt parent (Earth)", () => {
    expect(isGatedMoonParent("EARTH")).toBe(false);
  });
  it("is false for the Sun, a moon, a moonless planet, and null/undefined", () => {
    expect(isGatedMoonParent("SUN")).toBe(false);
    expect(isGatedMoonParent("EUROPA")).toBe(false);
    expect(isGatedMoonParent("VENUS")).toBe(false);
    expect(isGatedMoonParent(null)).toBe(false);
    expect(isGatedMoonParent(undefined)).toBe(false);
  });
});

describe("shouldShowMoonDetail", () => {
  it("always shows non-gated parents (planet helio orbit, Earth's Moon)", () => {
    expect(shouldShowMoonDetail("SUN", null)).toBe(true);
    expect(shouldShowMoonDetail("SUN", "JUPITER")).toBe(true);
    expect(shouldShowMoonDetail("EARTH", null)).toBe(true); // Moon exempt
    expect(shouldShowMoonDetail("EARTH", "JUPITER")).toBe(true);
  });
  it("hides a gated moon when nothing or another system is focused", () => {
    expect(shouldShowMoonDetail("JUPITER", null)).toBe(false);
    expect(shouldShowMoonDetail("JUPITER", "VENUS")).toBe(false);
    expect(shouldShowMoonDetail("JUPITER", "SATURN")).toBe(false);
    expect(shouldShowMoonDetail("JUPITER", "TITAN")).toBe(false);
  });
  it("shows a gated moon when its own system is focused (parent or sibling)", () => {
    expect(shouldShowMoonDetail("JUPITER", "JUPITER")).toBe(true);
    expect(shouldShowMoonDetail("JUPITER", "EUROPA")).toBe(true);
    expect(shouldShowMoonDetail("JUPITER", "GANYMEDE")).toBe(true);
  });
  it("treats an undefined parent as non-gated (always show)", () => {
    expect(shouldShowMoonDetail(undefined, null)).toBe(true);
    expect(shouldShowMoonDetail(undefined, "JUPITER")).toBe(true);
  });
});

describe("isMoonParentCollapsed", () => {
  it("is true for a gated parent whose system is not revealed", () => {
    expect(isMoonParentCollapsed("JUPITER", null)).toBe(true);
    expect(isMoonParentCollapsed("JUPITER", "SATURN")).toBe(true);
  });
  it("is false once the parent's own system is revealed", () => {
    expect(isMoonParentCollapsed("JUPITER", "JUPITER")).toBe(false);
    expect(isMoonParentCollapsed("JUPITER", "EUROPA")).toBe(false);
  });
  it("is false for the exempt parent and for non-parents", () => {
    expect(isMoonParentCollapsed("EARTH", null)).toBe(false);
    expect(isMoonParentCollapsed("VENUS", null)).toBe(false);
  });
  it("is false for an undefined parent", () => {
    expect(isMoonParentCollapsed(undefined, null)).toBe(false);
  });
});
