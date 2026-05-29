import type { BodyKey } from "@/app/constants/BodyVisuals";

// Per-body scene decorations — the single "switch" for Saturn's rings and the
// atmospheric halos. Visual-only; no simulation impact. A future stylized scene
// variant (todo #38) would gate/restyle these from here.

export interface RingConfig {
  /** Inner ring radius as a multiple of the planet's world radius. */
  innerScale: number;
  /** Outer ring radius as a multiple of the planet's world radius. */
  outerScale: number;
  /** Cassini division center, as a multiple of the planet's world radius. */
  cassiniScale: number;
  /** Axial tilt (radians) applied to the whole body group (planet + rings). */
  tiltRad: number;
}

export interface HaloConfig {
  /** Rim-glow tint (hex). */
  tint: string;
  /** Fresnel exponent — higher = tighter rim. */
  power: number;
  /** Max rim alpha. */
  intensity: number;
  /** Shell radius as a multiple of the planet's world radius. */
  radiusScale: number;
}

// Saturn only. ~26.7 deg obliquity = 0.466 rad.
export const RING_BODIES: Partial<Record<BodyKey, RingConfig>> = {
  SATURN: { innerScale: 1.2, outerScale: 2.3, cassiniScale: 1.95, tiltRad: 0.466 },
};

// Bodies with a visible atmosphere. Starting tints/intensities — tuned on screen.
export const HALO_BODIES: Partial<Record<BodyKey, HaloConfig>> = {
  EARTH: { tint: "#a8c8ff", power: 3.0, intensity: 0.6, radiusScale: 1.03 },
  JUPITER: { tint: "#ffe4c4", power: 3.0, intensity: 0.5, radiusScale: 1.03 },
  SATURN: { tint: "#ffedc4", power: 3.0, intensity: 0.45, radiusScale: 1.03 },
  URANUS: { tint: "#c8f0ee", power: 3.0, intensity: 0.5, radiusScale: 1.04 },
  NEPTUNE: { tint: "#a8c0ff", power: 3.0, intensity: 0.55, radiusScale: 1.04 },
};
