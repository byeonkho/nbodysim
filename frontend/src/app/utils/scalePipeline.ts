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

// Log preset defaults — these are tuning starting points. Final values
// get picked at the post-Phase-3 tuning gate and baked into
// `devSettingsStore.DEFAULTS`. Until then, sliders override these.
export const DEFAULT_LOG_SCALE_A = 60;
export const DEFAULT_LOG_R_REF_M = 149_597_870_700; // 1 AU
// Power-law exponent for body-radius compression in Log preset.
// (R / 1e8) ^ k. k = 1 collapses to linear (real ratios, tiny inner planets);
// k = 0.5 is sqrt — pleasant compression where Sun stays dominant but Moon /
// Mercury / Mars remain visibly distinct. No floor: the power-law itself
// raises tiny bodies to visible sizes without flattening them together.
export const DEFAULT_LOG_RADIUS_EXPONENT = 0.55;

/**
 * Convert a real heliocentric distance in metres to world units, per
 * preset. Realistic: linear divide by REALISTIC_DIVISOR. Log: log1p
 * compression with live-tunable A and r_ref from devSettingsStore.
 */
export function worldDistance(r_m: number, preset: ScalePreset): number {
  if (preset === "realistic") {
    return r_m / REALISTIC_DIVISOR;
  }
  // Log preset: A * log10(1 + r / r_ref).
  const { logScaleA, logScaleRRef } = getDevSettings();
  return logScaleA * Math.log10(1 + r_m / logScaleRRef);
}

/**
 * Convert a real body radius in metres to world units, per preset.
 * Realistic: linear divide, no compression — bodies stay at their truth
 * ratio, which makes most planets dots at default zoom. Log: power-law
 * compression `(R / 1e8) ^ k` so the ~400× real spread (Sun vs Moon)
 * collapses to a usable ~30× spread where every body is visible AND
 * visibly distinct.
 */
export function worldRadius(R_m: number, preset: ScalePreset): number {
  const linear = R_m / REALISTIC_DIVISOR;
  if (preset === "realistic") {
    return linear;
  }
  const { logRadiusExponent } = getDevSettings();
  return Math.pow(linear, logRadiusExponent);
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

  const compressed = worldDistance(r_m, preset);
  const minGap = parentWorldRadius_wu + childWorldRadius_wu * 3; // child + 2× buffer
  const finalDist = compressed > minGap ? compressed : minGap;

  const scale = finalDist / r_m;
  out.x = dx * scale;
  out.y = dy * scale;
  out.z = dz * scale;
}
