"use client";

import { useEffect } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/app/store/Store";
import {
  selectCelestialBodyPropertiesList,
  selectHasReceivedFirstChunk,
} from "@/app/store/slices/SimulationSlice";

declare global {
  interface Window {
    // Published only under NEXT_PUBLIC_E2E so a Playwright journey can assert
    // the scene's semantic content (how many bodies, has the first chunk
    // painted) without diffing canvas pixels. Absent in production.
    __scene?: { bodyCount: number; painted: boolean };
  }
}

// e2e-only scene probe. Mounted next to <Scene /> only when NEXT_PUBLIC_E2E is
// set, so it never ships in the production render path. Not a hot path: it reads
// two rarely-changing selectors (body list length, first-chunk flag) and writes
// the summary on change, never inside the frame loop.
export function E2eSceneProbe() {
  const bodyCount = useSelector(
    (s: RootState) => selectCelestialBodyPropertiesList(s)?.length ?? 0,
  );
  const painted = useSelector(selectHasReceivedFirstChunk);

  useEffect(() => {
    window.__scene = { bodyCount, painted };
  }, [bodyCount, painted]);

  return null;
}
