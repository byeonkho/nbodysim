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
  | "MOON";

// Canonical pill-row order. All 10 bodies surfaced — N-body framing is
// a feature, not a footnote.
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
];

// Mirrors --color-body-* CSS tokens (globals.css). Held as raw hex here so
// shadeColor can darken at runtime; @theme vars aren't directly readable
// inside inline `style` props without var() indirection.
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
};

// NAIF integer ids — same identifiers used by Orekit / JPL Horizons.
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
};

// Re-export the texture map keyed by BodyKey for ergonomic typed access.
// Source of truth for textures stays in SimConstants.
export const BODY_TEXTURE: Record<BodyKey, StaticImageData> = (
  Object.fromEntries(
    BODY_ORDER.map((key) => [key, (TEXTURE_PROPERTIES[key] as BodyProperties).texture]),
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
