"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import {
  readStoredCameraPreset,
  readStoredDisplayFrame,
  setCameraPreset,
  setDisplayFrame,
} from "@/app/store/slices/SimulationSlice";
import { readTourSeen, startTour } from "@/app/store/slices/TourSlice";

// Reconciles the SSR-safe initial Redux state with values persisted in
// localStorage. Runs once on mount, post-hydration, so the server-rendered
// HTML and the client's first React render agree on the SSR-safe defaults
// (cameraPreset="top-down", displayFrame="helio") — no hydration mismatch.
//
// On non-default preferences the user sees a one-frame flicker as the
// store updates. Standard tradeoff for SSR + per-user state in localStorage;
// the alternatives (suppressHydrationWarning, persist gate, server-cookie
// round-trips) are heavier and don't suit the scope here.
//
// Renders nothing.
export function PrefsHydrator() {
  const dispatch = useDispatch();

  useEffect(() => {
    const storedFrame = readStoredDisplayFrame();
    if (storedFrame && storedFrame !== "helio") {
      dispatch(setDisplayFrame(storedFrame));
    }
    const storedCam = readStoredCameraPreset();
    if (storedCam && storedCam !== "top-down") {
      dispatch(setCameraPreset(storedCam));
    }

    // First-timer intro tour: auto-start once, desktop only. Suppressed on
    // narrow/coarse-pointer viewports (the spotlight + glass tooltip are not
    // designed to reflow to a phone). We intentionally do NOT mark it seen on
    // mobile — a visitor who first lands on a phone still gets the tour if
    // they later return on desktop.
    const isDesktop =
      window.innerWidth >= 768 &&
      !window.matchMedia("(pointer: coarse)").matches;
    if (isDesktop && !readTourSeen()) {
      dispatch(startTour(undefined));
    }

    // Single-shot on mount; ignore prefs changes from other tabs (no
    // multi-tab requirement). Add a `storage` event listener here if
    // that ever changes.
  }, [dispatch]);

  return null;
}
