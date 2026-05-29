/**
 * Playback quality presets — the user-facing axis that maps to the
 * backend's per-integrator emission settings via the {@code fidelityBucket}
 * enum sent on /initialize.
 *
 * <p>Backend resolves each bucket to either {@code keyframesPerKept} (K,
 * for fixed-step integrators) or {@code targetSnapshotsPerChunk} (N, for
 * DP853 under Mode C time-gap thinning). Frontend just picks the bucket;
 * what it resolves to depends on the integrator the session uses.
 *
 * <p>Mirror of backend {@code FidelityBucket} enum. Wire names match
 * exactly. K/N preview tables are for UI tooltips only — backend is the
 * source of truth.
 */

// 5 buckets, ordered low → high quality (left-to-right in the picker).
// Wire names match backend FidelityBucket.wireName.
export const FIDELITY_BUCKETS = [
  "low",
  "medLow",
  "medium",
  "medHigh",
  "high",
] as const;

export type FidelityBucket = (typeof FIDELITY_BUCKETS)[number];

export const BUCKET_LABELS: Record<FidelityBucket, string> = {
  low: "Low",
  medLow: "Med-Low",
  medium: "Medium",
  medHigh: "Med-High",
  high: "High",
};

/**
 * Per-integrator landing default — the bucket the Sim Setup modal surfaces
 * on first open and when switching integrators mid-config.
 *
 * <p>Must mirror backend {@code FidelityBucket.defaultFor()}. Drift means
 * the UI shows one bucket as "active" while the backend actually uses a
 * different one when the bucket field is null.
 */
export const INTEGRATOR_DEFAULT_BUCKETS: Record<string, FidelityBucket> = {
  euler: "medHigh",
  rk4: "medium",
  dp853: "medLow",
};

/**
 * Bucket → K (keyframesPerKept) preview for fixed-step integrators
 * (Euler, RK4). Mirror of backend FidelityBucket enum constants.
 * Display-only: backend computes the actual K from the bucket directly.
 */
export const K_BY_BUCKET: Record<FidelityBucket, number> = {
  low: 20,
  medLow: 10,
  medium: 5,
  medHigh: 2,
  high: 1,
};

/**
 * Bucket → N (targetSnapshotsPerChunk) preview for DP853. Mirror of
 * backend FidelityBucket enum constants. Display-only.
 */
export const N_BY_BUCKET: Record<FidelityBucket, number> = {
  low: 3000,
  medLow: 5000,
  medium: 7500,
  medHigh: 10000,
  high: 15000,
};
