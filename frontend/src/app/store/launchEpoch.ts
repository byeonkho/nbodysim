// Monotonic counter bumped once at the start of every simulation launch
// (live or preset clip). Async sequences capture the value current when they
// begin and re-check it before each store-mutating dispatch; a mismatch means
// a newer launch superseded them, so they bail. This fences the clip and
// ground-truth paths the way the chunk thunk's sessionID check fences the
// live chunk path, and unlike sessionID it works for the sessionless clip
// path (simulationMetaData is null there).
let launchEpoch = 0;

export function beginLaunch(): number {
  return ++launchEpoch;
}

export function currentLaunchEpoch(): number {
  return launchEpoch;
}

export function isCurrentLaunch(epoch: number): boolean {
  return epoch === launchEpoch;
}

// Test-only: reset the module counter between cases.
export function resetLaunchEpochForTests(): void {
  launchEpoch = 0;
}
