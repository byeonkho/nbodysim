import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setIsPaused, setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import {
  FRAME_CODE,
  type TimeUnit,
} from "@/app/constants/SimParams";
import {
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";

// Fixed sim parameters every canonical scenario shares. Same defaults both
// builders ship with so the backend request shape is identical. Exported so
// the clip staleness guard and the clip matcher compare against this single
// source of truth.
export const PRESET_EPOCH = "2024-06-05T00:00:00.000";
export const PRESET_INTEGRATOR = "rk4";
export const PRESET_TIME_UNIT: TimeUnit = "Hours";

// The request shape the backend launch path consumes. `frame` is the display
// LABEL (e.g. "Heliocentric"), not the backend code; runSimulation converts it.
// Matches what SimSetupModal stores in lastSimRequest.
export interface SimulationRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: TimeUnit;
  fidelityBucket: FidelityBucket;
}

// Single launch path shared by both builders. Mirrors SimSetupModal.handleSubmit
// exactly: initialize -> read sessionID -> store lastRequest (LABEL frame) ->
// request chunks -> unpause.
export async function runSimulation(
  dispatch: AppDispatch,
  req: SimulationRequest,
  opts?: { onRetry?: () => void },
): Promise<boolean> {
  if (req.celestialBodyNames.length === 0) return false;

  const ok = await initializeCelestialBodies(
    dispatch,
    { ...req, frame: FRAME_CODE[req.frame] ?? req.frame },
    { onRetry: opts?.onRetry },
  );
  if (!ok) return false;

  const sessionID =
    store.getState().simulation.simulationParameters?.simulationMetaData
      ?.sessionID;
  if (!sessionID) return false;

  dispatch(setLastSimRequest(req));
  dispatchChunkRequest(dispatch, { sessionID });
  dispatch(setIsPaused(false));
  return true;
}
