import type { AppDispatch } from "@/app/store/Store";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";
import { DEFAULT_FRAME } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import {
  runSimulation,
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "@/app/utils/runSimulation";
import { DEFAULT_CLIP_ID } from "@/app/constants/ClipPresets";
import { runStaticClip } from "@/app/utils/runStaticClip";

// First-mount autorun for both chromes: play the default clip with zero backend
// calls; if it can't play, fall back to a live default run. The session re-check
// is the key guard: a user who submitted from the builder during the clip load
// has a live session by now, and replacing it with the default would silently
// discard their chosen sim (and orphan their backend session for 15 minutes).
// Lives apart from the chrome components (FirstMountAutorun calls it) so it can
// be unit-tested without a DOM.
export async function autorunDefaultScenario(
  dispatch: AppDispatch,
  getSessionID: () => string | undefined,
): Promise<void> {
  const ok = await runStaticClip(dispatch, DEFAULT_CLIP_ID);
  if (ok) return;
  if (getSessionID()) return;
  await runSimulation(dispatch, {
    celestialBodyNames: DEFAULT_SELECTED.map((k) => BODY_DISPLAY[k]),
    date: PRESET_EPOCH,
    frame: DEFAULT_FRAME,
    integrator: PRESET_INTEGRATOR,
    timeStepUnit: PRESET_TIME_UNIT,
    fidelityBucket: INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow",
  });
}
