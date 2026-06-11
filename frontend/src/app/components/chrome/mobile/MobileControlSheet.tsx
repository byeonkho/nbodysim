"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import type { CelestialBodyProperties } from "@/app/store/slices/SimulationSlice";
import {
  setActiveBody,
  cycleSimulationScale,
  toggleShowOrbitPaths,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  selectShowOrbitPaths,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
  selectCelestialBodyPropertiesList,
} from "@/app/store/slices/SimulationSlice";
import { MobileTransportBar } from "./MobileTransportBar";
import {
  MOBILE_PRESETS,
  DEFAULT_PRESET_ID,
  type MobilePreset,
} from "@/app/constants/MobilePresets";
import { runPreset } from "@/app/utils/runPreset";
import { runStaticClip } from "@/app/utils/runStaticClip";

// Collapsed peek height: the grab handle plus the transport bar. Expanded is a
// share of the viewport. This is a plain CSS sheet rather than a vaul drawer:
// the persistent always-open peek pattern fought vaul's snap-point math (it
// parked the sheet off-screen), so the control surface owns its own height.
const COLLAPSED_PX = 96;
const EXPANDED_HEIGHT = "60dvh";

function Chip({
  on = false,
  label,
  value,
  onClick,
}: {
  on?: boolean;
  label: string;
  value?: string;
  onClick: () => void;
}) {
  // A value chip (value provided) is a selector with no "off" state, so it
  // always renders lit and shows its current value on the right, matching the
  // desktop Scale/Camera chips. An on/off chip lights only when active.
  const hasValue = value !== undefined;
  const lit = hasValue || on;
  return (
    <button
      onClick={onClick}
      className={`flex h-11 w-full items-center gap-1.5 rounded-chip border px-3 text-sm transition-colors ${
        hasValue ? "justify-between" : "justify-center"
      } ${
        lit
          ? "border-[rgba(164,168,255,0.28)] bg-[rgba(164,168,255,0.12)] text-accent"
          : "border-white/[0.06] text-dim hover:bg-white/[0.04] hover:text-hi"
      }`}
    >
      <span>{label}</span>
      {hasValue && <span className="text-hi tabular">{value}</span>}
    </button>
  );
}

export function MobileControlSheet() {
  const dispatch = useDispatch<AppDispatch>();
  const [expanded, setExpanded] = useState(false);

  const showOrbits = useSelector(selectShowOrbitPaths);
  const showLabels = useSelector(selectShowPlanetInfoOverlay);
  const showTrails = useSelector(selectShowTrails);
  const scale = useSelector(selectSimulationScale);
  const bodies = useSelector(selectCelestialBodyPropertiesList);

  // Mirror the desktop Timeline label: "Realistic" renders as "Real",
  // everything else (currently "Log") renders as "Stylized".
  const scaleLabel = scale?.name === "Realistic" ? "Real" : "Stylized";

  const launch = (p: MobilePreset) => {
    setExpanded(false);
    // The default scenario reuses the free static clip; the other presets are
    // explicit user intent and run live (real session).
    if (p.id === DEFAULT_PRESET_ID) {
      void runStaticClip(dispatch).then((ok) => {
        if (!ok) void runPreset(dispatch, p);
      });
      return;
    }
    void runPreset(dispatch, p);
  };

  const selectBody = (name: string) => {
    // Collapse so the body detail sheet (z-30, below this sheet) is visible.
    setExpanded(false);
    dispatch(setActiveBody(name));
  };

  // Portals to document.body so the sheet sits at the same stacking level as
  // the vaul body sheet (z-40 control over z-30 body). Mobile chrome only ever
  // renders client-side (gated behind useIsMobile), so document is defined; the
  // guard is defensive in case that gating ever changes.
  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      aria-label="Playback and view controls"
      className="glass-dock pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden text-text transition-[height] duration-300 ease-out"
      style={{ height: expanded ? EXPANDED_HEIGHT : `${COLLAPSED_PX}px` }}
    >
      <button
        type="button"
        aria-label={expanded ? "Collapse controls" : "Expand controls"}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full shrink-0 items-center justify-center py-3"
      >
        {/* A chevron, not a drag grab-handle: this sheet toggles on tap. Points
            up to expand when collapsed, flips down to collapse when open. */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`text-white/40 transition-transform duration-300 ${
            expanded ? "rotate-180" : ""
          }`}
        >
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      <div className="shrink-0">
        <MobileTransportBar />
      </div>

      {/* Expanded controls. inert when collapsed: clipped by overflow-hidden,
          and kept out of the tab order / accessibility tree until revealed. */}
      <div
        inert={!expanded}
        className="flex-1 space-y-4 overflow-y-auto px-4 pb-8"
      >
        <div>
          <div className="eyebrow mb-2">
            Scenarios
          </div>
          <div className="flex flex-wrap gap-2">
            {MOBILE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => launch(p)}
                className="h-11 rounded-chip border border-white/[0.06] px-3 text-sm text-dim transition-colors hover:bg-white/[0.04] hover:text-hi"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">
            View
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Chip label="Orbits" on={showOrbits} onClick={() => dispatch(toggleShowOrbitPaths())} />
              <Chip label="Labels" on={showLabels} onClick={() => dispatch(toggleShowPlanetInfoOverlay())} />
              <Chip label="Trails" on={showTrails} onClick={() => dispatch(toggleShowTrails())} />
            </div>
            <Chip label="Scale" value={scaleLabel} onClick={() => dispatch(cycleSimulationScale())} />
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">
            Bodies
          </div>
          <div className="flex flex-wrap gap-2">
            {bodies
              .filter((b: CelestialBodyProperties): b is CelestialBodyProperties & { name: string } => !!b.name)
              .map((b) => (
                <button
                  key={b.name}
                  onClick={() => selectBody(b.name)}
                  className="h-11 rounded-chip border border-white/[0.06] px-3 text-sm text-dim transition-colors hover:bg-white/[0.04] hover:text-hi"
                >
                  {b.name}
                </button>
              ))}
          </div>
        </div>
      </div>
    </section>,
    document.body,
  );
}
