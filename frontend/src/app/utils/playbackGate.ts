// Pure decision logic for the playback gate (hidden-tab auto-pause + the
// idle "still watching?" pause). Extracted for unit-testability — the
// component that wires these to document events and the redux store is
// thin glue, same split as animationStep.ts / AnimationController.
//
// Scope (locked at design time): NO pause on window blur. Losing focus while
// staying visible is a supported viewing mode (second monitor, side-by-side
// windows); only actual invisibility and genuine inactivity gate playback.

// Ten unattended minutes before the idle pause. Bounds the worst case of an
// abandoned live session streaming chunks indefinitely (a 16x session pulls
// roughly half a gigabyte per hour from the backend).
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// How often the idle check runs. Coarse on purpose: activity listeners just
// stamp a timestamp; this interval compares it against the timeout, so the
// pause lands at most this long after the timeout elapses.
export const IDLE_CHECK_INTERVAL_MS = 30 * 1000;

export interface VisibilityDecisionInput {
  hidden: boolean; // document.hidden after the visibilitychange event
  isPaused: boolean; // current playback pause state
  pausedByGate: boolean; // whether the gate caused the current pause
}

export interface VisibilityDecision {
  action: "pause" | "resume" | "none";
  pausedByGate: boolean; // next value of the ownership flag
}

// The ownership flag is the contract's core: the gate only ever resumes a
// pause it created. A pause the user chose before hiding the tab survives
// the round trip untouched.
export function decideOnVisibilityChange(
  input: VisibilityDecisionInput,
): VisibilityDecision {
  const { hidden, isPaused, pausedByGate } = input;

  if (hidden) {
    if (!isPaused) {
      return { action: "pause", pausedByGate: true };
    }
    return { action: "none", pausedByGate };
  }

  if (pausedByGate) {
    if (isPaused) {
      return { action: "resume", pausedByGate: false };
    }
    // Something else resumed while hidden — release ownership quietly.
    return { action: "none", pausedByGate: false };
  }

  return { action: "none", pausedByGate: false };
}

export interface IdleCheckInput {
  now: number;
  lastActivityAt: number;
  isPaused: boolean;
  hidden: boolean;
  isLiveSession: boolean; // sessioned playback streams chunks; preset clips don't
}

// Preset clips are static assets with zero backend cost, so they may play
// unattended forever (kiosk-style); only live sessions idle out.
export function shouldIdlePause(input: IdleCheckInput): boolean {
  const { now, lastActivityAt, isPaused, hidden, isLiveSession } = input;
  if (isPaused || hidden || !isLiveSession) return false;
  return now - lastActivityAt >= IDLE_TIMEOUT_MS;
}
