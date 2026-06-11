"use client";

import React, { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { setCameraPreset } from "@/app/store/slices/SimulationSlice";
import { MobileControlSheet } from "./MobileControlSheet";
import { MobileBodySheet } from "./MobileBodySheet";
import { MOBILE_PRESETS, DEFAULT_PRESET_ID } from "@/app/constants/MobilePresets";
import { runPreset } from "@/app/utils/runPreset";

export function MobileChrome() {
  const dispatch = useDispatch<AppDispatch>();
  const bootedRef = useRef(false);

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
      <MobileControlSheet />
      <MobileBodySheet />
    </>
  );
}
