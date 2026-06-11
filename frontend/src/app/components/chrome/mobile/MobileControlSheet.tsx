"use client";

import React, { useState } from "react";
import { Drawer } from "vaul";
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

const COLLAPSED = "84px";
const EXPANDED = 0.6;

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
  const [snap, setSnap] = useState<number | string | null>(COLLAPSED);

  const showOrbits = useSelector(selectShowOrbitPaths);
  const showLabels = useSelector(selectShowPlanetInfoOverlay);
  const showTrails = useSelector(selectShowTrails);
  const scale = useSelector(selectSimulationScale);
  const bodies = useSelector(selectCelestialBodyPropertiesList);

  // Mirror the desktop Timeline label: "Realistic" renders as "Real",
  // everything else (currently "Log") renders as "Stylized".
  const scaleLabel = scale?.name === "Realistic" ? "Real" : "Stylized";

  const launch = (p: MobilePreset) => {
    setSnap(COLLAPSED);
    void runPreset(dispatch, p);
  };

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={[COLLAPSED, EXPANDED]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Content className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl bg-[#0b0d16]/95 text-white backdrop-blur">
          <Drawer.Handle className="my-2" />
          <MobileTransportBar />

          {/* Expanded-only controls */}
          <div className="space-y-4 overflow-y-auto px-4 pb-8">
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
                      onClick={() => dispatch(setActiveBody(b.name))}
                      className="h-11 rounded-lg bg-white/10 px-3 text-sm"
                    >
                      {b.name}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
