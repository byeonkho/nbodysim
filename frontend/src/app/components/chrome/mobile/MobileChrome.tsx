"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import {
  setCameraPreset,
  selectIsBodyActive,
} from "@/app/store/slices/SimulationSlice";
import { MobileControlSheet } from "./MobileControlSheet";
import { MobileBodySheet } from "./MobileBodySheet";
import { MobileSimSetupSheet } from "./MobileSimSetupSheet";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";
import { DEFAULT_FRAME } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import {
  runSimulation,
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "@/app/utils/runSimulation";
import { DEFAULT_CLIP_ID } from "@/app/constants/ClipPresets";
import { runStaticClip } from "@/app/utils/runStaticClip";
import { MobileTourOverlay } from "./MobileTourOverlay";
import { MobilePlanetRail } from "./MobilePlanetRail";

export function MobileChrome() {
  const dispatch = useDispatch<AppDispatch>();
  const bootedRef = useRef(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const isBodyActive = useSelector(selectIsBodyActive);
  // The build FAB rides the control sheet's top edge (rendered by the sheet so
  // it tracks the sheet's height). Hide it while another bottom sheet is up
  // (body detail or the build sheet itself).
  const showFab = !setupOpen && !isBodyActive;

  useEffect(() => {
    // Mobile is free-camera only (the top-down preset is cut on mobile, and the
    // slice default is "top-down"), so force "free" on mount regardless of any
    // prior desktop preset.
    dispatch(setCameraPreset("free"));

    // Auto-run the default scenario once on first mobile mount, but only if no
    // sim session already exists (e.g. user resized down from desktop).
    if (bootedRef.current) return;
    bootedRef.current = true;
    const hasSession =
      !!store.getState().simulation.simulationParameters?.simulationMetaData
        ?.sessionID;
    if (hasSession) return;
    // Default scenario plays from the precomputed static asset: zero backend
    // calls on a bounce. If the asset is somehow unreachable (a build that
    // shipped without it), fall back to a live run so the scene still appears.
    void (async () => {
      const ok = await runStaticClip(dispatch, DEFAULT_CLIP_ID);
      if (ok) return;
      void runSimulation(dispatch, {
        celestialBodyNames: DEFAULT_SELECTED.map((k) => BODY_DISPLAY[k]),
        date: PRESET_EPOCH,
        frame: DEFAULT_FRAME,
        integrator: PRESET_INTEGRATOR,
        timeStepUnit: PRESET_TIME_UNIT,
        fidelityBucket:
          INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow",
      });
    })();
  }, [dispatch]);

  return (
    <>
      <MobilePlanetRail />

      <MobileControlSheet
        buildFabHidden={!showFab}
        onBuildClick={() => setSetupOpen(true)}
      />
      <MobileBodySheet />
      <MobileSimSetupSheet open={setupOpen} onOpenChange={setSetupOpen} />
      <MobileTourOverlay />
    </>
  );
}
