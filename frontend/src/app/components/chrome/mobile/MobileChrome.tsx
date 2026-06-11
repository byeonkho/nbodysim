"use client";

import React, { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { setCameraPreset } from "@/app/store/slices/SimulationSlice";
import { MobileControlSheet } from "./MobileControlSheet";
import { MobileBodySheet } from "./MobileBodySheet";
import { MobileSimSetupSheet } from "./MobileSimSetupSheet";
import { MOBILE_PRESETS, DEFAULT_PRESET_ID } from "@/app/constants/MobilePresets";
import { runPreset } from "@/app/utils/runPreset";
import { runStaticClip } from "@/app/utils/runStaticClip";

export function MobileChrome() {
  const dispatch = useDispatch<AppDispatch>();
  const bootedRef = useRef(false);
  const [setupOpen, setSetupOpen] = useState(false);

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
      const ok = await runStaticClip(dispatch);
      if (ok) return;
      const preset =
        MOBILE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID) ??
        MOBILE_PRESETS[0];
      void runPreset(dispatch, preset);
    })();
  }, [dispatch]);

  return (
    <>
      {/* Always-visible "build a simulation" entry, top-left over the canvas.
          Hidden behind the builder's own scrim while it is open. */}
      <button
        type="button"
        aria-label="Build simulation"
        onClick={() => setSetupOpen(true)}
        className="pointer-events-auto fixed left-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/[0.08] text-accent transition-colors hover:text-hi"
        style={{
          background: "rgba(20,22,30,0.62)",
          backdropFilter: "blur(22px) saturate(150%)",
          WebkitBackdropFilter: "blur(22px) saturate(150%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        {/* Solar-system glyph: sun + two tilted nested orbits + two planets. */}
        <svg
          width="25"
          height="25"
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

      <MobileControlSheet />
      <MobileBodySheet />
      <MobileSimSetupSheet open={setupOpen} onOpenChange={setSetupOpen} />
    </>
  );
}
