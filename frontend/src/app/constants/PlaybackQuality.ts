/**
 * Playback quality presets — the user-facing axis that maps to the
 * backend's keyframeIntervalSec lever (see Hermite Phase 2 spec). Higher
 * "quality" = more keyframes shipped per chunk = smoother playback per
 * step but larger compressed payloads. Lower quality = fewer keyframes,
 * Hermite interpolation fills the gaps. The "× stepDt" framing is internal;
 * the user picks a label or types a custom multiplier.
 */
export const PLAYBACK_QUALITY_PRESETS = {
  high:    { multiplier: 1,  label: "High" },
  medHigh: { multiplier: 2,  label: "Med-High" },
  medium:  { multiplier: 4,  label: "Medium" },
  medLow:  { multiplier: 8,  label: "Med-Low" },
  low:     { multiplier: 16, label: "Low" },
} as const;

export type PlaybackQualityKey = keyof typeof PLAYBACK_QUALITY_PRESETS;

/**
 * Default preset per integrator. Rationale (from the spec):
 * - euler:  K=1 — Euler is already crude; no point ditching keyframes.
 * - rk4:    K=4 — balanced; interpolation hides most thinning artifacts.
 * - dp853:  K=8 — DP853's orbits are smooth and over-sampled at fixed dt,
 *           so aggressive thinning + Hermite still looks great.
 */
export const INTEGRATOR_QUALITY_DEFAULTS: Record<string, PlaybackQualityKey> = {
  euler:  "high",
  rk4:    "medium",
  dp853:  "medLow",
};

/**
 * Mirror of `SimulationLimits.MAX_KEYFRAMES_PER_KEPT` on the backend.
 * Kept in sync manually — if the backend cap changes, change here too.
 */
export const MAX_QUALITY_MULTIPLIER = 100;

/**
 * Returns the preset key whose multiplier matches the given value, or
 * null if no preset matches (i.e., the picker is in "custom" mode).
 */
export function getActivePresetKey(multiplier: number): PlaybackQualityKey | null {
  for (const [key, preset] of Object.entries(PLAYBACK_QUALITY_PRESETS) as Array<
    [PlaybackQualityKey, { multiplier: number; label: string }]
  >) {
    if (preset.multiplier === multiplier) return key;
  }
  return null;
}

/**
 * Converts the drawer's timeStepUnit string to seconds. Mirrors the
 * backend's stepDtSeconds switch in SimulationController. The drawer's
 * TIME_UNITS values are capitalized ("Seconds", "Hours", "Days", "Weeks");
 * this function is case-insensitive to be defensive.
 */
export function stepDtSeconds(timeStepUnit: string): number {
  switch (timeStepUnit.toLowerCase()) {
    case "seconds": return 1;
    case "hours":   return 3600;
    case "days":    return 86400;
    case "weeks":   return 7 * 86400;
    default:
      throw new Error(`Unsupported time step unit: ${timeStepUnit}`);
  }
}

/**
 * Parses + validates a string from the "Custom" numeric input. Accepts
 * positive integers in [1, MAX_QUALITY_MULTIPLIER]. Returns either a
 * parsed value (error null) or a user-facing error message (value null).
 */
export function parseCustomMultiplier(
  raw: string,
): { value: number; error: null } | { value: null; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: null, error: "Enter a number" };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { value: null, error: "Must be a whole number" };
  }
  const n = Number(trimmed);
  if (n < 1) {
    return { value: null, error: "Must be at least 1" };
  }
  if (n > MAX_QUALITY_MULTIPLIER) {
    return { value: null, error: `Must be at most ${MAX_QUALITY_MULTIPLIER}` };
  }
  return { value: n, error: null };
}
