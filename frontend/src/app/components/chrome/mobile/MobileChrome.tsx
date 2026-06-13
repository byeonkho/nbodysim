"use client";

import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import {
  setCameraPreset,
  selectIsBodyActive,
} from "@/app/store/slices/SimulationSlice";
import { MobileControlSheet } from "./MobileControlSheet";
import { MobileBodySheet } from "./MobileBodySheet";
import { MobileSimSetupSheet } from "./MobileSimSetupSheet";
import { MobileTourOverlay } from "./MobileTourOverlay";
import { MobilePlanetRail } from "./MobilePlanetRail";

export function MobileChrome() {
  const dispatch = useDispatch<AppDispatch>();
  const [setupOpen, setSetupOpen] = useState(false);
  const isBodyActive = useSelector(selectIsBodyActive);
  // The build FAB rides the control sheet's top edge (rendered by the sheet so
  // it tracks the sheet's height). Hide it while another bottom sheet is up
  // (body detail or the build sheet itself).
  const showFab = !setupOpen && !isBodyActive;

  useEffect(() => {
    // Mobile is free-camera only (the top-down preset is cut on mobile, and the
    // slice default is "top-down"), so force "free" on mount regardless of any
    // prior desktop preset. First-load autorun now lives in FirstMountAutorun,
    // rendered once by Layout for both chromes.
    dispatch(setCameraPreset("free"));
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
      <MobileTourOverlay buildSheetOpen={setupOpen} />
    </>
  );
}
