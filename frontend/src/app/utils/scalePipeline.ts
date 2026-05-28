// frontend/src/app/utils/scalePipeline.ts
//
// Scale pipeline — real metres → world units, per preset. Two presets:
//   - "realistic": linear divide. Bodies are dots, ratios are physically
//     accurate. Truth reference.
//   - "log":      log1p-compressed radial distance + power-law compressed
//     body radii. Whole solar system fits in one viewport with every
//     planet visibly separated and distinguishable.
//
// Both presets go through the same `worldDistance` / `worldRadius` calls;
// the preset arg picks which internal config applies. Realistic is a
// degenerate case (linear-divide, no compression) of the same plumbing.
//
// Log-preset params (A, r_ref, body k) are tunable at runtime via the
// dev panel — they live in `devSettingsStore` so the sliders, the
// pipeline, and the test setup all share one source of truth.

import { getDevSettings } from "@/app/dev/devSettingsStore";
import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

export type ScalePreset = "realistic" | "log";

// Realistic preset: every metre divided by this. Identical to current
// `radiusScale = positionScale = 1e8` behavior. Bodies render at
// real_size / 1e8, distances at real_distance / 1e8.
export const REALISTIC_DIVISOR = 1e8;

// Log preset production defaults. Picked at the 2026-05-20 tuning gate
// after live dev-mode tuning of the visible-system view. Live-overridable
// in dev mode via devSettingsStore (?dev=1 unlocks the slider panel).
export const DEFAULT_LOG_SCALE_A = 60;
export const DEFAULT_LOG_R_REF_M = 149_597_870_700; // 1 AU
// Power-law exponent for body-radius compression in Log preset.
// (R / 1e8) ^ k. k = 1 collapses to linear (real ratios, tiny inner planets);
// k = 0.5 is sqrt — pleasant compression where Sun stays dominant but Moon /
// Mercury / Mars remain visibly distinct.
export const DEFAULT_LOG_RADIUS_EXPONENT = 0.5;

// Minimum world-radius applied AFTER the power-law in Log preset only. The
// power-law alone is enough for everything down to dwarf planets, but the
// smallest named NEAs (Apophis 185 m, Bennu 245 m, Ryugu 435 m) end up
// sub-pixel under any reasonable zoom. 0.02 wu lifts those four to a barely
// visible dot while leaving Moon (0.132 wu), Pluto (0.109 wu), the dwarf
// planets (0.046–0.069 wu), and everything larger fully unaffected — the
// previous floor experiment was abandoned because it flattened Moon and
// Earth to the same size; this floor is set well below the smallest "real"
// body so that doesn't recur.
export const DEFAULT_LOG_MIN_RADIUS = 0.02;

/**
 * Per-parent log compression params. Heliocentric log compression
 * (A=60, rRef=1 AU) crushes parent-relative moon distances into a
 * tiny fraction of a world unit, so every moon ends up at the
 * min-separation floor — visually clumped on top of its parent.
 * Per-parent curves spread each parent system out into a usable
 * visual range.
 *
 * With A=5 and rRef set to the parent's innermost-moon real distance,
 * the innermost moon renders at 5*log10(2) ≈ 1.5 wu and outer moons
 * spread proportionally to their real distance ratios.
 */
export interface LogScaleParams {
  A: number;
  rRef: number;
}

export const MOON_LOG_SCALE: Record<string, LogScaleParams> = {
  EARTH:   { A: 5, rRef: 3.84e8 },   // Moon
  MARS:    { A: 5, rRef: 9.38e6 },   // Phobos
  JUPITER: { A: 5, rRef: 4.218e8 },  // Io
  SATURN:  { A: 5, rRef: 1.855e8 },  // Mimas
  URANUS:  { A: 5, rRef: 1.297e8 },  // Miranda
  NEPTUNE: { A: 5, rRef: 3.5476e8 }, // Triton
  PLUTO:   { A: 5, rRef: 1.96e7 },   // Charon
};

/**
 * Convert a real heliocentric distance in metres to world units, per
 * preset. Realistic: linear divide by REALISTIC_DIVISOR. Log: log1p
 * compression with live-tunable A and r_ref from devSettingsStore,
 * or an optional override (used by worldDistanceFromParent to apply
 * per-parent log curves for moon systems).
 */
export function worldDistance(
  r_m: number,
  preset: ScalePreset,
  override?: LogScaleParams,
): number {
  if (preset === "realistic") {
    return r_m / REALISTIC_DIVISOR;
  }
  // Log preset: A * log10(1 + r / r_ref).
  if (override) {
    return override.A * Math.log10(1 + r_m / override.rRef);
  }
  const { logScaleA, logScaleRRef } = getDevSettings();
  return logScaleA * Math.log10(1 + r_m / logScaleRRef);
}

/**
 * Convert a real body radius in metres to world units, per preset.
 * Realistic: linear divide, no compression — bodies stay at their truth
 * ratio, which makes most planets dots at default zoom. Log: power-law
 * compression `(R / 1e8) ^ k` so the ~400× real spread (Sun vs Moon)
 * collapses to a usable ~30× spread where every body is visible AND
 * visibly distinct. A minimum-radius floor is applied AFTER the power-law
 * so the smallest NEAs stay on-screen; see {@link DEFAULT_LOG_MIN_RADIUS}.
 * Realistic preset ignores the floor.
 */
export function worldRadius(R_m: number, preset: ScalePreset): number {
  const linear = R_m / REALISTIC_DIVISOR;
  if (preset === "realistic") {
    return linear;
  }
  // R=0 short-circuits to 0 so the degenerate "no body" case doesn't
  // get lifted to the floor (which would surprise consumers that check
  // for a zero radius to distinguish "no body" from "tiny body").
  if (R_m === 0) {
    return 0;
  }
  const { logRadiusExponent, logMinRadius } = getDevSettings();
  const compressed = Math.pow(linear, logRadiusExponent);
  return compressed > logMinRadius ? compressed : logMinRadius;
}

/**
 * Body-agnostic minimum-separation rule for child-of-parent bodies.
 * Writes the rendered world-space delta (child relative to parent) into
 * `out`. If the compressed child-parent distance is comfortably outside
 * the parent's rendered radius, passes through unchanged. If the child
 * would visually merge with its parent, pushes the child out to a
 * comfortable visual gap.
 *
 * Threshold: parentWorldRadius + childWorldRadius + 2 * childWorldRadius.
 * The 2× buffer keeps the child clearly separate from the parent's limb
 * even at oblique camera angles.
 *
 * Direction is preserved by scaling the unit vector from parent → child.
 * Degenerate input (identical positions) writes the zero vector — caller
 * is responsible for handling that case if needed.
 *
 * Mutating-output convention matches helpers.tsx (allocation-free for
 * hot-path useFrame consumers).
 */
export function worldDistanceFromParent(
  childPos_m: Vector3Simple,
  parentPos_m: Vector3Simple,
  parentWorldRadius_wu: number,
  childWorldRadius_wu: number,
  preset: ScalePreset,
  out: Vector3Simple,
  parentName?: string,
): void {
  const dx = childPos_m.x - parentPos_m.x;
  const dy = childPos_m.y - parentPos_m.y;
  const dz = childPos_m.z - parentPos_m.z;
  const r_m = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (r_m === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }

  // For non-Sun parents, use the per-parent log curve so each planet
  // system has its own visual scale instead of all moons collapsing
  // to one ring outside the parent. SUN/undefined falls through to
  // heliocentric compression (existing behavior).
  const override =
    parentName && parentName !== "SUN" ? MOON_LOG_SCALE[parentName] : undefined;
  const compressed = worldDistance(r_m, preset, override);
  const minGap = parentWorldRadius_wu + childWorldRadius_wu * 3; // child + 2× buffer
  const finalDist = compressed > minGap ? compressed : minGap;

  const scale = finalDist / r_m;
  out.x = dx * scale;
  out.y = dy * scale;
  out.z = dz * scale;
}
