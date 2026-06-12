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
import { MOBILE_BUILD_TOUR_TARGET } from "@/app/constants/mobileTourSteps";
import { MobilePlanetRail } from "./MobilePlanetRail";

export function MobileChrome() {
  const dispatch = useDispatch<AppDispatch>();
  const bootedRef = useRef(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const isBodyActive = useSelector(selectIsBodyActive);
  // The build FAB belongs to the foreground scene. Hide it while a bottom sheet
  // is up (body detail or the build sheet). The control sheet covers it on its
  // own via stacking order, so it needs no flag here.
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
      // Asset unreachable (a build shipped without it): live run of the same
      // default scenario so the scene still appears.
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

      {/* Build a simulation: a bottom-right floating action button in the
          one-handed thumb zone. 8rem (128px) clears the collapsed control sheet,
          which reserves its own bottom breathing room; the env terms grow the
          gap with the home indicator and keep it off the landscape side notch.
          Hidden while a bottom sheet is open. */}
      {showFab && (
        <button
          type="button"
          aria-label="Build simulation"
          data-tour={MOBILE_BUILD_TOUR_TARGET}
          onClick={() => setSetupOpen(true)}
          className="pointer-events-auto fixed z-20 grid h-14 w-14 place-items-center rounded-full border border-white/[0.08] text-accent transition-colors hover:text-hi"
          style={{
            right: "calc(1rem + env(safe-area-inset-right, 0px))",
            bottom: "calc(8rem + env(safe-area-inset-bottom, 0px))",
            background: "rgba(20,22,30,0.62)",
            backdropFilter: "blur(22px) saturate(150%)",
            WebkitBackdropFilter: "blur(22px) saturate(150%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {/* Solar-system glyph: sun + two tilted nested orbits + two planets. */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <ellipse cx="12" cy="12" rx="10.4" ry="5.2" transform="rotate(-25 12 12)" />
            <ellipse cx="12" cy="12" rx="6.2" ry="3" transform="rotate(-25 12 12)" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
            <circle cx="21.43" cy="7.61" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="6.38" cy="14.62" r="1.3" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}

      <MobileControlSheet />
      <MobileBodySheet />
      <MobileSimSetupSheet open={setupOpen} onOpenChange={setSetupOpen} />
      <MobileTourOverlay />
    </>
  );
}
