import { describe, it, expect } from "vitest";
import {
  BODY_ORDER,
  BODY_COLOR,
  BODY_DISPLAY,
  BODY_NAIF,
  BODY_CATEGORY,
  BODY_TEXTURE,
  type BodyKey,
  isBodyKey,
  toBodyKey,
} from "@/app/constants/BodyVisuals";

const ALL_19: BodyKey[] = [
  "SUN", "MERCURY", "VENUS", "EARTH", "MARS",
  "JUPITER", "SATURN", "URANUS", "NEPTUNE", "MOON",
  "PLUTO", "CERES", "VESTA", "PALLAS", "HYGIEA",
  "EROS", "APOPHIS", "BENNU", "RYUGU",
];

describe("BodyVisuals catalog", () => {
  it("BODY_ORDER includes all 19 keys", () => {
    for (const key of ALL_19) {
      expect(BODY_ORDER.includes(key)).toBe(true);
    }
    expect(BODY_ORDER.length).toBe(19);
  });

  it("BODY_COLOR has valid hex for every key", () => {
    for (const key of ALL_19) {
      expect(BODY_COLOR[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("BODY_DISPLAY has truthy strings for every key", () => {
    for (const key of ALL_19) {
      expect(BODY_DISPLAY[key]).toBeTruthy();
      expect(typeof BODY_DISPLAY[key]).toBe("string");
    }
  });

  it("BODY_NAIF has identifiers for every key", () => {
    for (const key of ALL_19) {
      expect(BODY_NAIF[key]).toBeTruthy();
    }
    // Spot-check a couple SPK ids for minor bodies (must match backend).
    expect(BODY_NAIF.EROS).toBe("2000433");
    expect(BODY_NAIF.APOPHIS).toBe("2099942");
  });

  it("BODY_TEXTURE resolves for every key (FALLBACK for bodies without dedicated textures yet)", () => {
    // We only assert the entry is defined — the StaticImageData shape
    // (.src, .width, .height) is populated by Next.js's image-import
    // loader, which doesn't run in Vitest's Node environment. The build
    // step is the real check that textures resolve correctly.
    for (const key of ALL_19) {
      expect(BODY_TEXTURE).toHaveProperty(key);
    }
  });
});

describe("BodyVisuals categories", () => {
  it("planets vs dwarf planets vs asteroids", () => {
    // Major planets + Sun + Moon.
    for (const key of [
      "SUN", "MERCURY", "VENUS", "EARTH", "MARS",
      "JUPITER", "SATURN", "URANUS", "NEPTUNE", "MOON",
    ] as BodyKey[]) {
      expect(BODY_CATEGORY[key]).toBe("planet");
    }
    // Dwarf planets + massive main-belt asteroids.
    for (const key of [
      "PLUTO", "CERES", "VESTA", "PALLAS", "HYGIEA",
    ] as BodyKey[]) {
      expect(BODY_CATEGORY[key]).toBe("dwarfPlanet");
    }
    // NEAs.
    for (const key of [
      "EROS", "APOPHIS", "BENNU", "RYUGU",
    ] as BodyKey[]) {
      expect(BODY_CATEGORY[key]).toBe("asteroid");
    }
  });
});

describe("BodyVisuals helpers stay consistent with extended catalog", () => {
  it("isBodyKey accepts all 19 (case-insensitive)", () => {
    for (const key of ALL_19) {
      expect(isBodyKey(key)).toBe(true);
      expect(isBodyKey(key.toLowerCase())).toBe(true);
    }
  });

  it("isBodyKey rejects unknown names", () => {
    expect(isBodyKey("XYZZY")).toBe(false);
    expect(isBodyKey("")).toBe(false);
    expect(isBodyKey(null)).toBe(false);
  });

  it("toBodyKey normalizes input", () => {
    expect(toBodyKey("eros")).toBe("EROS");
    expect(toBodyKey("Apophis")).toBe("APOPHIS");
    expect(toBodyKey("nope")).toBe(null);
  });
});
