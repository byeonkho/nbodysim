import { StaticImageData } from "next/image";
import {
  bodyProperties as TEXTURE_PROPERTIES,
  type BodyProperties,
} from "@/app/constants/SimConstants";

// Canonical visual data for celestial bodies — color tokens (from the design
// handoff palette), NAIF identifiers, display names, and stable ordering.
//
// Scene 3D rendering still pulls textures from SimConstants.bodyProperties.
// This module is for UI chrome (selector pills, body card sphere, ghost-label
// dots, mobile chip). Phase 1B's stylized scene variant will also read from
// here.

export type BodyKey =
  | "SUN"
  | "MERCURY"
  | "VENUS"
  | "EARTH"
  | "MARS"
  | "JUPITER"
  | "SATURN"
  | "URANUS"
  | "NEPTUNE"
  | "MOON"
  // Major moons — sourced via Horizons bare-NAIF-ID path (see backend
  // MoonCatalog). They share the "planet" category and render inside the
  // Planets section, sub-grouped by parent at the UI layer.
  | "PHOBOS"
  | "DEIMOS"
  | "IO"
  | "EUROPA"
  | "GANYMEDE"
  | "CALLISTO"
  | "MIMAS"
  | "ENCELADUS"
  | "TETHYS"
  | "DIONE"
  | "RHEA"
  | "TITAN"
  | "IAPETUS"
  | "ARIEL"
  | "UMBRIEL"
  | "TITANIA"
  | "OBERON"
  | "MIRANDA"
  | "TRITON"
  | "NEREID"
  | "CHARON"
  // Minor bodies — dwarf planets, large main-belt asteroids, named NEAs.
  | "PLUTO"
  | "CERES"
  | "VESTA"
  | "PALLAS"
  | "HYGIEA"
  | "EROS"
  | "APOPHIS"
  | "BENNU"
  | "RYUGU";

export type BodyCategory = "planet" | "dwarfPlanet" | "asteroid";

// Grouping for SimSetupDrawer sectioning. SUN and MOON ride with the planets
// for selector grouping purposes (they're "always-on" components of the
// inner system, not standalone categories worth their own section).
export const BODY_CATEGORY: Record<BodyKey, BodyCategory> = {
  SUN: "planet",
  MERCURY: "planet",
  VENUS: "planet",
  EARTH: "planet",
  MARS: "planet",
  JUPITER: "planet",
  SATURN: "planet",
  URANUS: "planet",
  NEPTUNE: "planet",
  MOON: "planet",
  // Major moons share the "planet" category so they appear inside the
  // existing Planets section. The drawer groups them under per-parent
  // sub-headers at the UI layer; the category itself stays flat so the
  // section-level master toggle still means "select everything here".
  PHOBOS: "planet",
  DEIMOS: "planet",
  IO: "planet",
  EUROPA: "planet",
  GANYMEDE: "planet",
  CALLISTO: "planet",
  MIMAS: "planet",
  ENCELADUS: "planet",
  TETHYS: "planet",
  DIONE: "planet",
  RHEA: "planet",
  TITAN: "planet",
  IAPETUS: "planet",
  ARIEL: "planet",
  UMBRIEL: "planet",
  TITANIA: "planet",
  OBERON: "planet",
  MIRANDA: "planet",
  TRITON: "planet",
  NEREID: "planet",
  CHARON: "planet",
  PLUTO: "dwarfPlanet",
  CERES: "dwarfPlanet",
  VESTA: "dwarfPlanet",
  PALLAS: "dwarfPlanet",
  HYGIEA: "dwarfPlanet",
  EROS: "asteroid",
  APOPHIS: "asteroid",
  BENNU: "asteroid",
  RYUGU: "asteroid",
};

// Canonical pill-row / body-list order. Planets first, then dwarf planets,
// then near-Earth asteroids — same partitioning the backend's
// SimulationFactory uses to sort the integrator state buffer.
export const BODY_ORDER: readonly BodyKey[] = [
  "SUN",
  "MERCURY",
  "VENUS",
  "EARTH",
  "MARS",
  "JUPITER",
  "SATURN",
  "URANUS",
  "NEPTUNE",
  // Moons grouped by parent in physical (inner-to-outer) order.
  "MOON",
  "PHOBOS",
  "DEIMOS",
  "IO",
  "EUROPA",
  "GANYMEDE",
  "CALLISTO",
  "MIMAS",
  "ENCELADUS",
  "TETHYS",
  "DIONE",
  "RHEA",
  "TITAN",
  "IAPETUS",
  "MIRANDA",
  "ARIEL",
  "UMBRIEL",
  "TITANIA",
  "OBERON",
  "TRITON",
  "NEREID",
  "CHARON",
  "PLUTO",
  "CERES",
  "VESTA",
  "PALLAS",
  "HYGIEA",
  "EROS",
  "APOPHIS",
  "BENNU",
  "RYUGU",
];

// Mirrors --color-body-* CSS tokens (globals.css). Held as raw hex here so
// shadeColor can darken at runtime; @theme vars aren't directly readable
// inside inline `style` props without var() indirection.
//
// Minor-body palette: muted earth tones (rocky asteroid aesthetic).
export const BODY_COLOR: Record<BodyKey, string> = {
  SUN: "#ffb554",
  MERCURY: "#a59387",
  VENUS: "#e6c692",
  EARTH: "#5d8fd6",
  MARS: "#c5573a",
  JUPITER: "#d4a566",
  SATURN: "#dcb474",
  URANUS: "#7fc7c5",
  NEPTUNE: "#4a78c0",
  MOON: "#bfc4cc",
  // Mars moons — dark gray-brown (carbonaceous chondrite spectra).
  PHOBOS: "#7a7064",
  DEIMOS: "#857a6c",
  // Galileans — distinctive colors.
  IO: "#e6c878", // sulfur yellow
  EUROPA: "#d6c8b0", // off-white ice
  GANYMEDE: "#a89684", // tan
  CALLISTO: "#6c604c", // dark brown
  // Saturn moons — icy whites and grays.
  MIMAS: "#c8c4bc",
  ENCELADUS: "#e8e6e0",
  TETHYS: "#c0bcb4",
  DIONE: "#b8b4ac",
  RHEA: "#a8a49c",
  TITAN: "#c89854", // orange haze
  IAPETUS: "#9c8870", // two-tone, averaged to brown
  // Uranus moons — uniform dark gray (low albedo).
  ARIEL: "#888078",
  UMBRIEL: "#605850",
  TITANIA: "#807870",
  OBERON: "#706860",
  MIRANDA: "#988c80",
  // Neptune moons.
  TRITON: "#c0a890", // pinkish (nitrogen ice + tholin)
  NEREID: "#807870",
  // Pluto's Charon — reddish-brown polar cap mixed with neutral gray.
  CHARON: "#988880",
  PLUTO: "#c8b8a6",
  CERES: "#b8a890",
  VESTA: "#a89880",
  PALLAS: "#9c8c74",
  HYGIEA: "#8c7c68",
  EROS: "#a09080",
  APOPHIS: "#8a7c6c",
  BENNU: "#544a40",
  RYUGU: "#3c352e",
};

// NAIF integer ids — same identifiers used by Orekit / JPL Horizons.
// Minor-body ids are SPK numbers (Horizons CGI accepts the same values).
export const BODY_NAIF: Record<BodyKey, string> = {
  SUN: "10",
  MERCURY: "199",
  VENUS: "299",
  EARTH: "399",
  MARS: "499",
  JUPITER: "599",
  SATURN: "699",
  URANUS: "799",
  NEPTUNE: "899",
  MOON: "301",
  PHOBOS: "401",
  DEIMOS: "402",
  IO: "501",
  EUROPA: "502",
  GANYMEDE: "503",
  CALLISTO: "504",
  MIMAS: "601",
  ENCELADUS: "602",
  TETHYS: "603",
  DIONE: "604",
  RHEA: "605",
  TITAN: "606",
  IAPETUS: "608",
  ARIEL: "701",
  UMBRIEL: "702",
  TITANIA: "703",
  OBERON: "704",
  MIRANDA: "705",
  TRITON: "801",
  NEREID: "802",
  CHARON: "901",
  PLUTO: "999",
  CERES: "2000001",
  VESTA: "2000004",
  PALLAS: "2000002",
  HYGIEA: "2000010",
  EROS: "2000433",
  APOPHIS: "2099942",
  BENNU: "2101955",
  RYUGU: "2162173",
};

export const BODY_DISPLAY: Record<BodyKey, string> = {
  SUN: "Sun",
  MERCURY: "Mercury",
  VENUS: "Venus",
  EARTH: "Earth",
  MARS: "Mars",
  JUPITER: "Jupiter",
  SATURN: "Saturn",
  URANUS: "Uranus",
  NEPTUNE: "Neptune",
  MOON: "Moon",
  PHOBOS: "Phobos",
  DEIMOS: "Deimos",
  IO: "Io",
  EUROPA: "Europa",
  GANYMEDE: "Ganymede",
  CALLISTO: "Callisto",
  MIMAS: "Mimas",
  ENCELADUS: "Enceladus",
  TETHYS: "Tethys",
  DIONE: "Dione",
  RHEA: "Rhea",
  TITAN: "Titan",
  IAPETUS: "Iapetus",
  ARIEL: "Ariel",
  UMBRIEL: "Umbriel",
  TITANIA: "Titania",
  OBERON: "Oberon",
  MIRANDA: "Miranda",
  TRITON: "Triton",
  NEREID: "Nereid",
  CHARON: "Charon",
  PLUTO: "Pluto",
  CERES: "Ceres",
  VESTA: "Vesta",
  PALLAS: "Pallas",
  HYGIEA: "Hygiea",
  EROS: "Eros",
  APOPHIS: "Apophis",
  BENNU: "Bennu",
  RYUGU: "Ryugu",
};

// Re-export the texture map keyed by BodyKey for ergonomic typed access.
// Source of truth for textures stays in SimConstants. Bodies without a
// dedicated texture yet (minor bodies pre-Phase-4 textures) fall back to
// the FALLBACK entry so the module loads cleanly.
export const BODY_TEXTURE: Record<BodyKey, StaticImageData> = (
  Object.fromEntries(
    BODY_ORDER.map((key) => {
      const props = TEXTURE_PROPERTIES[key] as BodyProperties | undefined;
      const fallback = TEXTURE_PROPERTIES["FALLBACK"] as BodyProperties;
      return [key, (props ?? fallback).texture];
    }),
  ) as Record<BodyKey, StaticImageData>
);

// Darken a hex color by `percent` per channel (0–255). Negative darkens.
// Drives the radial-gradient outer stop (design's "60% darker" terminator).
export function shadeColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = clamp((num >> 16) + percent);
  const g = clamp(((num >> 8) & 0xff) + percent);
  const b = clamp((num & 0xff) + percent);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, v));
}

// Inline-style background for a body sphere. Matches the chrome rendering
// from the handoff: radial gradient from body color (top-left highlight)
// to a 60-points-darker outer ring.
export function bodyGradient(key: BodyKey): string {
  const c = BODY_COLOR[key];
  return `radial-gradient(circle at 30% 30%, ${c} 0%, ${c} 50%, ${shadeColor(c, -60)} 100%)`;
}

export function isBodyKey(name: string | null | undefined): name is BodyKey {
  if (!name) return false;
  const upper = name.trim().toUpperCase();
  return (BODY_ORDER as readonly string[]).includes(upper);
}

export function toBodyKey(name: string): BodyKey | null {
  const upper = name.trim().toUpperCase();
  return (BODY_ORDER as readonly string[]).includes(upper)
    ? (upper as BodyKey)
    : null;
}

// RGB triplet in [0, 1] for shaders / vertex colors. Three.js expects
// floats in this range, not 0-255 ints.
export function bodyColorRgb01(key: BodyKey): [number, number, number] {
  const num = parseInt(BODY_COLOR[key].replace("#", ""), 16);
  return [
    ((num >> 16) & 0xff) / 255,
    ((num >> 8) & 0xff) / 255,
    (num & 0xff) / 255,
  ];
}
