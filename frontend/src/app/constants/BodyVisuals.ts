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
  "MOON",
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
