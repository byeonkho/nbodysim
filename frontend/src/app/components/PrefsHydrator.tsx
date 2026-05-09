"use client";

import { useEffect } from "react";
import { useDispatch } from "react-redux";
import {
  readStoredCameraPreset,
  readStoredDisplayFrame,
  setCameraPreset,
  setDisplayFrame,
} from "@/app/store/slices/SimulationSlice";

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
    // Single-shot on mount; ignore prefs changes from other tabs (no
    // multi-tab requirement). Add a `storage` event listener here if
    // that ever changes.
  }, [dispatch]);

  return null;
}
