// frontend/src/app/utils/scalePipeline.ts
//
// Scale pipeline — real metres → world units, per preset. Two presets:
//   - "realistic": linear divide. Bodies are dots, ratios are physically
//     accurate. Truth reference.
//   - "log":      log1p-compressed radial distance + clickability floor on
//     body radii. Whole solar system fits in one viewport with every
//     planet visibly separated.
//
// Both presets go through the same `worldDistance` / `worldRadius` calls;
// the preset arg picks which internal config applies. Realistic is a
// degenerate case (identity-divide, no floor) of the same plumbing.
//
// Log-preset params (A, r_ref, R_floor) are tunable at runtime via the
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
export const DEFAULT_LOG_RADIUS_FLOOR_WU = 0.5;
