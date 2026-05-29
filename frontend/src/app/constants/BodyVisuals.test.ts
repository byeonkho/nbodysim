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
  it("BODY_ORDER includes all 19 base keys", () => {
    for (const key of ALL_19) {
      expect(BODY_ORDER.includes(key)).toBe(true);
    }
    // 19 base bodies + 21 major moons = 40.
    expect(BODY_ORDER.length).toBe(40);
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

const NEW_MOONS: BodyKey[] = [
  "PHOBOS", "DEIMOS",
  "IO", "EUROPA", "GANYMEDE", "CALLISTO",
  "MIMAS", "ENCELADUS", "TETHYS", "DIONE", "RHEA", "TITAN", "IAPETUS",
  "ARIEL", "UMBRIEL", "TITANIA", "OBERON", "MIRANDA",
  "TRITON", "NEREID",
  "CHARON",
];

describe("BodyVisuals — moon entries", () => {
  it("each new moon has an entry in every table", () => {
    for (const key of NEW_MOONS) {
      expect(BODY_ORDER).toContain(key);
      // Moons share the existing "planet" category so the drawer renders
      // them inside the Planets section (sub-grouped by parent in Phase 6).
      expect(BODY_CATEGORY[key]).toBe("planet");
      expect(BODY_COLOR[key]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(BODY_NAIF[key]).toMatch(/^\d{3}$/);
      expect(BODY_DISPLAY[key]).toBeTruthy();
    }
  });

  it("Earth's Moon stays in the planet category (unchanged)", () => {
    expect(BODY_ORDER).toContain("MOON");
    expect(BODY_CATEGORY.MOON).toBe("planet");
  });

  it("BODY_TEXTURE resolves for every new moon (FALLBACK until textures land)", () => {
    for (const key of NEW_MOONS) {
      expect(BODY_TEXTURE).toHaveProperty(key);
    }
  });

  it("BODY_NAIF for moons matches backend MoonCatalog NAIF IDs", () => {
    // Pinning a few — full set would just duplicate the catalog. The
    // spot-check catches accidental ID drift (e.g. Io <-> Europa swap).
    expect(BODY_NAIF.IO).toBe("501");
    expect(BODY_NAIF.TITAN).toBe("606");
    expect(BODY_NAIF.TRITON).toBe("801");
    expect(BODY_NAIF.CHARON).toBe("901");
    expect(BODY_NAIF.PHOBOS).toBe("401");
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
