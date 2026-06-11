import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setIsPaused, setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";
import { DEFAULT_FRAME, FRAME_CODE } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import type { MobilePreset } from "@/app/constants/MobilePresets";

// Fixed sim parameters shared by every mobile preset. Same defaults the
// desktop modal ships with so the backend request shape is identical.
const PRESET_EPOCH = "2024-06-05T00:00:00.000";
const PRESET_INTEGRATOR = "rk4";
const PRESET_TIME_UNIT = "Hours" as const;

export async function runPreset(
  dispatch: AppDispatch,
  preset: MobilePreset,
  opts?: { onRetry?: () => void },
): Promise<boolean> {
  const celestialBodyNames = preset.keys.map((k) => BODY_DISPLAY[k]);
  if (celestialBodyNames.length === 0) return false;

  // requestPayload mirrors the shape the modal stores in lastSimRequest:
  // frame is the LABEL (e.g. "Heliocentric"), not the backend code. The
  // backend call below converts label to code via FRAME_CODE, matching the
  // exact pattern in SimSetupModal.handleSubmit.
  const requestPayload = {
    celestialBodyNames,
    date: PRESET_EPOCH,
    frame: DEFAULT_FRAME,
    integrator: PRESET_INTEGRATOR,
    timeStepUnit: PRESET_TIME_UNIT,
    fidelityBucket: INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR],
  };

  const ok = await initializeCelestialBodies(
    dispatch,
    { ...requestPayload, frame: FRAME_CODE[DEFAULT_FRAME] ?? DEFAULT_FRAME },
    { onRetry: opts?.onRetry },
  );
  if (!ok) return false;

  const sessionID =
    store.getState().simulation.simulationParameters?.simulationMetaData
      ?.sessionID;
  if (!sessionID) return false;

  dispatch(setLastSimRequest(requestPayload));
  dispatchChunkRequest(dispatch, { sessionID });
  dispatch(setIsPaused(false));
  return true;
}
