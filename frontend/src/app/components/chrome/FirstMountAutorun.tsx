"use client";

import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import {
  selectHasActiveSimulation,
  selectSessionID,
} from "@/app/store/slices/SimulationSlice";
import { autorunDefaultScenario } from "@/app/utils/autorunDefaultScenario";

// First-load autorun, shared by desktop and mobile. Layout renders this once,
// outside the mobile/desktop branch, so it mounts a single time per page load
// and survives the responsive-breakpoint swap that remounts the chrome subtree.
// That single mount is the real fix for the restart bug: a per-chrome autorun
// re-fires when you cross the breakpoint mid-clip, and a session-only guard
// misses it because a static clip carries no session. Here the clip plays once
// and resizing never restarts it. Renders nothing — it exists only for the
// effect.
export function FirstMountAutorun() {
  const dispatch = useDispatch<AppDispatch>();
  const bootedRef = useRef(false);

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    // Defense in depth: never autorun over an already-loaded sim or clip. On a
    // fresh load nothing is loaded (no state persistence), so this proceeds.
    if (selectHasActiveSimulation(store.getState())) return;
    // The default scenario plays from the precomputed static asset (zero
    // backend calls); if the asset is unreachable it falls back to a live run.
    // The getter lets that fallback re-check for a session the visitor started
    // during the clip load, so we never clobber their own sim.
    void autorunDefaultScenario(dispatch, () =>
      selectSessionID(store.getState()),
    );
  }, [dispatch]);

  return null;
}
