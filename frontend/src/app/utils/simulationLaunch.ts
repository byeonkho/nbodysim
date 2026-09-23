import type { AppDispatch } from "@/app/store/Store";
import { beginLaunch, isCurrentLaunch } from "@/app/store/launchEpoch";
import { cancelChunkStream } from "@/app/store/middleware/simulationRequestThunk";
import {
  setLaunchInProgress,
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";

// A pending replacement owns request coordination even before it has a session.
// Keep old buffered playback, but stop its background work until the launch
// settles. Failure restores prefetch eligibility for the retained session.
export function beginSimulationLaunch(dispatch: AppDispatch): number {
  const epoch = beginLaunch();
  cancelChunkStream();
  dispatch(setRequestInProgress(false));
  dispatch(setLaunchInProgress(true));
  return epoch;
}

export function finishSimulationLaunch(
  dispatch: AppDispatch,
  epoch: number,
): void {
  if (!isCurrentLaunch(epoch)) return;
  dispatch(setLaunchInProgress(false));
  dispatch(setRequestInProgress(false));
}
