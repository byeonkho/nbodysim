"use client";

import React, { useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import {
  togglePause,
  setSpeedMultiplier,
  setCurrentTimeStepIndex,
  selectIsPaused,
  selectSpeedMultiplier,
  selectTotalTimeSteps,
  selectCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import { formatSpeed } from "@/app/utils/formatSpeed";

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function MobileTransportBar() {
  const dispatch = useDispatch<AppDispatch>();
  const isPaused = useSelector(selectIsPaused);
  const speed = useSelector(selectSpeedMultiplier);
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = total > 1 ? idx / (total - 1) : 0;

  const seek = (clientX: number) => {
    if (!trackRef.current || total <= 1) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    dispatch(setCurrentTimeStepIndex(Math.round(ratio * (total - 1))));
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <button
        aria-label="slow down"
        className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
        onClick={() => dispatch(setSpeedMultiplier("decrease"))}
      >
        &#8810;
      </button>
      <button
        aria-label={isPaused ? "play" : "pause"}
        className="grid h-12 w-12 place-items-center rounded-full bg-white text-black"
        onClick={() => dispatch(togglePause())}
      >
        {isPaused ? "▶" : "❚❚"}
      </button>
      <button
        aria-label="speed up"
        className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white"
        onClick={() => dispatch(setSpeedMultiplier("increase"))}
      >
        &#8811;
      </button>
      <span className="w-12 text-right text-xs tabular-nums text-white/80">
        {formatSpeed(speed)}&#215;
      </span>
      <div
        ref={trackRef}
        className="relative h-8 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) seek(e.clientX);
        }}
      >
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded bg-white/20" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-white"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{ left: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
