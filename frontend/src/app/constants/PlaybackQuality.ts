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
 *
 * <p>Note: the wire names (internal keys) are intentionally NOT the display
 * labels. The labels were shifted up one rung (so the coarser, bandwidth-
 * cheaper defaults read as mid-range rather than "Low") while the keys and
 * K/N values stayed put — e.g. key {@code "low"} displays as "Med-Low". The
 * label is the user-facing copy; the key is the wire contract.
 */

// 4 buckets, ordered low → high quality (left-to-right in the picker).
// Wire names match backend FidelityBucket.wireName.
export const FIDELITY_BUCKETS = [
  "low",
  "medLow",
  "medium",
  "medHigh",
] as const;

export type FidelityBucket = (typeof FIDELITY_BUCKETS)[number];

// Display labels, shifted up one rung from the wire names (see file header):
// the coarsest bucket reads as "Med-Low", not "Low".
export const BUCKET_LABELS: Record<FidelityBucket, string> = {
  low: "Med-Low",
  medLow: "Medium",
  medium: "Med-High",
  medHigh: "High",
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
  rk4: "medLow",
  dp853: "low",
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
};
