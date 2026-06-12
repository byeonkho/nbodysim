// Pure helper for AnimationController's per-frame index update. Extracted
// for unit-testability — AnimationController itself is tightly coupled to
// R3F's useFrame and the redux store, but the math is just arithmetic +
// clamping.
//
// The drive model is wall-clock-rate: per real-world second of elapsed
// playback, the simulation advances `speedMultiplier * fps` keyframe units.
// At fps=60 and speedMultiplier=1 this exactly matches the legacy
// integer-step throttled behavior (one step per 1/60s frame). At higher
// refresh rates, the per-frame step naturally shrinks below 1.0 — the
// chunkBuffer reads will Hermite-interpolate.
//
// Output is a float; clamped to [0, totalTimesteps - 1].
export interface ComputeNextIndexInput {
  currentIndex: number;
  delta: number; // seconds since last frame (from R3F useFrame)
  speedMultiplier: number; // signed; magnitude scales rate, sign sets direction
  fps: number; // nominal sim FPS — defines the "1 unit per frame" baseline
  totalTimesteps: number; // upper-bound (clamp at totalTimesteps - 1)
}

// Ceiling on the per-frame delta. rAF stops while a tab is hidden, so the
// first frame back reports the entire hidden duration as one delta — without
// a ceiling, ten hidden minutes at 1x teleports playback 36,000 keyframes.
// 0.25s comfortably covers real frame hitches (GC pauses, window drags) while
// capping any single frame's advance at a quarter-second of wall clock.
export const MAX_FRAME_DELTA_SECONDS = 0.25;

export function computeNextIndex(input: ComputeNextIndexInput): number {
  const { currentIndex, delta, speedMultiplier, fps, totalTimesteps } = input;
  const clampedDelta = Math.min(delta, MAX_FRAME_DELTA_SECONDS);
  const proposed = currentIndex + clampedDelta * fps * speedMultiplier;
  if (proposed < 0) return 0;
  if (proposed > totalTimesteps - 1) return totalTimesteps - 1;
  return proposed;
}
