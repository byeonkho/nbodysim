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
import { MOBILE_PRESETS, type MobilePreset } from "@/app/constants/MobilePresets";
import { runPreset } from "@/app/utils/runPreset";

// Collapsed peek height: the grab handle plus the transport bar. Expanded is a
// share of the viewport. This is a plain CSS sheet rather than a vaul drawer:
// the persistent always-open peek pattern fought vaul's snap-point math (it
// parked the sheet off-screen), so the control surface owns its own height.
const COLLAPSED_PX = 96;
const EXPANDED_HEIGHT = "60dvh";

function Chip({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 rounded-lg px-3 text-sm ${
        on ? "bg-white text-black" : "bg-white/10 text-white/80"
      }`}
    >
      {label}
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
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-2xl bg-[#0b0d16]/95 text-white backdrop-blur transition-[height] duration-300 ease-out"
      style={{ height: expanded ? EXPANDED_HEIGHT : `${COLLAPSED_PX}px` }}
    >
      <button
        type="button"
        aria-label={expanded ? "Collapse controls" : "Expand controls"}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full shrink-0 items-center justify-center py-3"
      >
        <span className="h-1.5 w-10 rounded-full bg-white/30" />
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
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">
            Scenarios
          </div>
          <div className="flex flex-wrap gap-2">
            {MOBILE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => launch(p)}
                className="h-11 rounded-lg bg-white/10 px-3 text-sm"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">
            View
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Chip label="Orbits" on={showOrbits} onClick={() => dispatch(toggleShowOrbitPaths())} />
            <Chip label="Labels" on={showLabels} onClick={() => dispatch(toggleShowPlanetInfoOverlay())} />
            <Chip label="Trails" on={showTrails} onClick={() => dispatch(toggleShowTrails())} />
            <Chip label={scaleLabel} on={false} onClick={() => dispatch(cycleSimulationScale())} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">
            Bodies
          </div>
          <div className="flex flex-wrap gap-2">
            {bodies
              .filter((b: CelestialBodyProperties): b is CelestialBodyProperties & { name: string } => !!b.name)
              .map((b) => (
                <button
                  key={b.name}
                  onClick={() => selectBody(b.name)}
                  className="h-11 rounded-lg bg-white/10 px-3 text-sm"
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
