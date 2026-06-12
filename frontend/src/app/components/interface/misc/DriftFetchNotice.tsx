"use client";

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import {
  selectOverlayEnabled,
  selectGroundTruthFetchInFlight,
} from "@/app/store/slices/GroundTruthSlice";

// Bottom-center notice for a slow drift-data load. The Drift chip pulses for
// every in-flight fetch; this only appears when a fetch has been pending long
// enough to mean the cold path (the backend waking from sleep, up to ~20 s),
// so the quiet wait gets an explanation. Warm fetches answer in well under a
// second and never show it.
const SLOW_FETCH_MS = 2000;

const DriftFetchNotice: React.FC = () => {
  const enabled = useSelector(selectOverlayEnabled);
  const fetching = useSelector(selectGroundTruthFetchInFlight);
  const pending = enabled && fetching;
  const [show, setShow] = useState(false);

  // Hide the moment the fetch settles. Guarded set-state-in-render (not in
  // the effect body) to satisfy the repo's set-state-in-effect lint rule.
  const [prevPending, setPrevPending] = useState(pending);
  if (prevPending !== pending) {
    setPrevPending(pending);
    if (!pending) setShow(false);
  }

  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => setShow(true), SLOW_FETCH_MS);
    return () => window.clearTimeout(id);
  }, [pending]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="text-hi pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-md border border-white/[0.08] px-4 py-2.5 text-sm shadow-lg"
      style={{
        background: "rgba(10, 12, 20, 0.96)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)",
      }}
    >
      <span className="animate-pulse text-accent">●</span>
      <span>
        Loading real-world positions. The first load can take a few moments
        while the simulator wakes up.
      </span>
    </div>
  );
};

export default DriftFetchNotice;
