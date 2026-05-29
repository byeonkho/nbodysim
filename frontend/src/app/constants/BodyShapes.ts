import type { BodyKey } from "@/app/constants/BodyVisuals";

// Per-body procedural shape config — the single "switch" for which bodies render
// as deformed rock instead of perfect spheres. Visual-only; no simulation impact.
// Bodies absent from this map render as plain spheres (all planets, Sun, Ceres,
// Pluto, and every major moon — they are genuinely round).

export interface ShapeConfig {
  /** Noise displacement as a fraction of radius (0 = none). */
  amplitude: number;
  /** Base spatial frequency of the noise sampled on the unit sphere. */
  frequency: number;
  /** Fractal octaves summed (lacunarity 2, gain 0.5). */
  octaves: number;
  /** Axis stretch [x, y, z] applied after displacement (1,1,1 = none). */
  scale: [number, number, number];
  /** Per-body seed so each shape is stable across sessions and distinct. */
  seed: number;
}

export const IRREGULAR_BODIES: Partial<Record<BodyKey, ShapeConfig>> = {
  // Strongly irregular small bodies.
  EROS:    { amplitude: 0.16, frequency: 1.6, octaves: 4, scale: [1.8, 0.7, 0.75], seed: 11 },
  APOPHIS: { amplitude: 0.18, frequency: 2.0, octaves: 4, scale: [1.6, 0.8, 0.85], seed: 23 },
  BENNU:   { amplitude: 0.1,  frequency: 1.8, octaves: 3, scale: [1.05, 0.88, 1.05], seed: 37 },
  RYUGU:   { amplitude: 0.1,  frequency: 1.8, octaves: 3, scale: [1.05, 0.9, 1.05], seed: 41 },
  PHOBOS:  { amplitude: 0.22, frequency: 1.5, octaves: 4, scale: [1.25, 0.95, 0.9], seed: 53 },
  DEIMOS:  { amplitude: 0.16, frequency: 1.5, octaves: 4, scale: [1.2, 0.95, 0.92], seed: 59 },

  // Subtle deformation on the mid-size asteroids (roughly round, mildly irregular).
  VESTA:   { amplitude: 0.06, frequency: 1.4, octaves: 3, scale: [1.0, 0.9, 1.0], seed: 67 },
  PALLAS:  { amplitude: 0.07, frequency: 1.6, octaves: 3, scale: [1.04, 0.95, 0.98], seed: 71 },
  HYGIEA:  { amplitude: 0.04, frequency: 1.5, octaves: 3, scale: [1.02, 0.98, 1.0], seed: 73 },
};
