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
    const preset =
      MOBILE_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID) ?? MOBILE_PRESETS[0];
    void runPreset(dispatch, preset);
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
        <svg
          width="20"
          height="20"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="11" cy="11" r="2.5" />
          <path d="M11 2.5v2.5M11 17v2.5M2.5 11h2.5M17 11h2.5M5 5l1.8 1.8M15.2 15.2L17 17M5 17l1.8-1.8M15.2 6.8L17 5" />
        </svg>
      </button>

      <MobileControlSheet />
      <MobileBodySheet />
      <MobileSimSetupSheet open={setupOpen} onOpenChange={setSetupOpen} />
    </>
  );
}
