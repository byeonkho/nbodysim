import { CLIP_PRESETS, type ClipPreset } from "@/app/constants/ClipPresets";
import {
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "@/app/utils/runSimulation";
import { DEFAULT_FRAME, type TimeUnit } from "@/app/constants/SimParams";
import {
  INTEGRATOR_DEFAULT_BUCKETS,
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";
import type { BodyKey } from "@/app/constants/BodyVisuals";

export interface ClipMatchInput {
  bodyKeys: ReadonlySet<BodyKey>;
  epoch: string;
  frame: string;
  integrator: string;
  timeStepUnit: TimeUnit;
  fidelityBucket: FidelityBucket;
}

// A configuration that exactly reproduces a canonical preset scenario can play
// the precomputed clip instead of waking the backend. The match is exact: the
// shared fixed params plus a set-equal body selection (order-insensitive).
// Anything else returns null and runs live. A false positive would serve the
// wrong physics; a false negative just costs a live run, so every comparison
// errs strict.
export function matchPresetClip(
  input: ClipMatchInput,
): ClipPreset["id"] | null {
  if (input.epoch !== PRESET_EPOCH) return null;
  if (input.frame !== DEFAULT_FRAME) return null;
  if (input.integrator !== PRESET_INTEGRATOR) return null;
  if (input.timeStepUnit !== PRESET_TIME_UNIT) return null;
  const defaultBucket =
    INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow";
  if (input.fidelityBucket !== defaultBucket) return null;

  for (const preset of CLIP_PRESETS) {
    if (preset.keys.length !== input.bodyKeys.size) continue;
    if (preset.keys.every((k) => input.bodyKeys.has(k))) return preset.id;
  }
  return null;
}
