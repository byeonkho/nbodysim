"use client";

import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  selectIsPaused,
  selectSessionID,
  setIsPaused,
} from "@/app/store/slices/SimulationSlice";
import { AppDispatch, RootState } from "@/app/store/Store";
import {
  IDLE_CHECK_INTERVAL_MS,
  decideOnVisibilityChange,
  shouldIdlePause,
} from "@/app/utils/playbackGate";

// Playback gate: pauses playback when the tab is hidden (auto-resuming on
// return only if the gate caused the pause) and idle-pauses unattended live
// sessions behind a "still watching?" card. Decision logic lives in
// playbackGate.ts; this component is the DOM/store glue.
//
// Deliberately NOT gated on window blur — losing focus while visible
// (second monitor, side-by-side windows) is a supported viewing mode.
//
// None of this runs per frame: a visibilitychange listener, passive activity
// listeners that stamp a timestamp ref, and a coarse 30s interval.

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export function PlaybackGate() {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  const isPaused = useSelector(selectIsPaused);
  const [idleNoticeOpen, setIdleNoticeOpen] = useState(false);

  const pausedByGateRef = useRef(false);
  const lastActivityAtRef = useRef(0);

  useEffect(() => {
    lastActivityAtRef.current = performance.now();

    const stampActivity = () => {
      lastActivityAtRef.current = performance.now();
      // Once the user is active during unpaused playback, the idle episode
      // is over — clear the flag so a later manual pause doesn't resurrect
      // the card. While idle-paused the flag survives (the card must stay
      // readable as the user mouses over to its button). Functional update
      // with same-value return bails out of re-rendering.
      if (!store.getState().simulation.timeState.isPaused) {
        setIdleNoticeOpen((open) => (open ? false : open));
      }
    };

    const onVisibilityChange = () => {
      const decision = decideOnVisibilityChange({
        hidden: document.hidden,
        isPaused: store.getState().simulation.timeState.isPaused,
        pausedByGate: pausedByGateRef.current,
      });
      pausedByGateRef.current = decision.pausedByGate;
      if (decision.action === "pause") dispatch(setIsPaused(true));
      if (decision.action === "resume") dispatch(setIsPaused(false));
      // Returning to the tab counts as activity — without this stamp, a
      // resume after a long-hidden stretch would idle out on the next check.
      if (!document.hidden) stampActivity();
    };

    const idleInterval = window.setInterval(() => {
      const state = store.getState();
      const idle = shouldIdlePause({
        now: performance.now(),
        lastActivityAt: lastActivityAtRef.current,
        isPaused: state.simulation.timeState.isPaused,
        hidden: document.hidden,
        isLiveSession: Boolean(selectSessionID(state)),
      });
      if (idle) {
        dispatch(setIsPaused(true));
        setIdleNoticeOpen(true);
      }
    }, IDLE_CHECK_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, stampActivity, { passive: true });
    }
    return () => {
      window.clearInterval(idleInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, stampActivity);
      }
    };
  }, [dispatch, store]);

  // Visibility is derived: the card shows only while the idle pause is
  // still in force. If the user answers "still watching?" by pressing play
  // anywhere (transport bar, keyboard), isPaused flips and the card hides
  // immediately — no state sync needed.
  if (!idleNoticeOpen || !isPaused) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-1/2 z-30 w-[280px] -translate-x-1/2 -translate-y-1/2">
      <div
        role="dialog"
        aria-label="Still watching?"
        className="glass px-5 py-4 text-center"
        style={{ borderRadius: 12 }}
      >
        <div className="eyebrow mb-1.5">PAUSED</div>
        <div className="text-hi mb-1 text-sm font-medium">Still watching?</div>
        <p className="mb-3 text-xs text-[var(--color-dim)]">
          Playback paused after ten quiet minutes.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => dispatch(setIsPaused(false))}
          className="glass w-full px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/[0.06]"
          style={{ borderRadius: 8 }}
        >
          Keep watching
        </button>
      </div>
    </div>
  );
}
