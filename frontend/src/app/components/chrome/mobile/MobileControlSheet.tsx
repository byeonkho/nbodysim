"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import {
  cycleSimulationScale,
  toggleShowOrbitPaths,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  setIsBodyActive,
  selectIsBodyActive,
  selectShowOrbitPaths,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
} from "@/app/store/slices/SimulationSlice";
import {
  setOverlayEnabled,
  selectOverlayEnabled,
  selectGroundTruthFetchInFlight,
} from "@/app/store/slices/GroundTruthSlice";
import { MobileTransportBar } from "./MobileTransportBar";
import { MOBILE_BUILD_TOUR_TARGET } from "@/app/constants/mobileTourSteps";

// This is a plain CSS sheet rather than a vaul drawer: the persistent
// always-open peek pattern fought vaul's snap-point math (it parked the sheet
// off-screen), so the control surface owns its own height. The sheet hugs its
// content: collapsed = chevron + transport bar; expanded adds the View section
// via an animated 0fr -> 1fr grid row (the CSS way to transition to an auto
// height), so no empty space below the last control.
//
// Breathing room below the controls so the transport row never kisses the
// screen edge, plus the device safe area (an iPhone home indicator) when the
// page opts into it.
const BOTTOM_INSET = "calc(env(safe-area-inset-bottom, 0px) + 14px)";

function Chip({
  on = false,
  label,
  value,
  busy = false,
  onClick,
}: {
  on?: boolean;
  label: string;
  value?: string;
  /** Pulses the label while the chip's data is still loading. */
  busy?: boolean;
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
      // 44px tall (the touch-target floor); on/off chips trim their side
      // padding so four fit across a 360px portrait row.
      className={`flex h-11 w-full items-center gap-1.5 rounded-chip border text-sm transition-colors ${
        hasValue ? "justify-between px-3" : "justify-center px-2"
      } ${
        lit
          ? "border-[rgba(164,168,255,0.28)] bg-[rgba(164,168,255,0.12)] text-accent"
          : "border-white/[0.06] text-dim hover:bg-white/[0.04] hover:text-hi"
      }`}
    >
      <span className={busy ? "animate-pulse" : undefined}>{label}</span>
      {hasValue && <span className="text-hi tabular">{value}</span>}
    </button>
  );
}

export function MobileControlSheet({
  buildFabHidden,
  onBuildClick,
}: {
  /** Hide the build button while another bottom sheet is up. */
  buildFabHidden: boolean;
  onBuildClick: () => void;
}) {
  const dispatch = useDispatch<AppDispatch>();
  const [expanded, setExpanded] = useState(false);
  const isBodyActive = useSelector(selectIsBodyActive);

  // Mutual exclusivity with the body detail sheet: both surfaces are
  // bottom-docked translucent glass, so stacking them reads as text soup.
  // Selecting a body (planet rail or a tap on the scene) collapses the
  // controls; expanding the controls dismisses the body sheet (below).
  // Guarded set-state-in-render per the repo's set-state-in-effect lint rule.
  const [prevBodyActive, setPrevBodyActive] = useState(isBodyActive);
  if (prevBodyActive !== isBodyActive) {
    setPrevBodyActive(isBodyActive);
    if (isBodyActive) setExpanded(false);
  }

  const toggleExpanded = () => {
    const next = !expanded;
    if (next && isBodyActive) dispatch(setIsBodyActive(false));
    setExpanded(next);
  };

  const showOrbits = useSelector(selectShowOrbitPaths);
  const showLabels = useSelector(selectShowPlanetInfoOverlay);
  const showTrails = useSelector(selectShowTrails);
  const scale = useSelector(selectSimulationScale);
  const drift = useSelector(selectOverlayEnabled);
  // Flips rarely (per ground-truth fetch), so a plain subscription is fine.
  const driftBusy = useSelector(selectGroundTruthFetchInFlight);

  // Mirror the desktop Timeline label: "Realistic" renders as "Real",
  // everything else (currently "Log") renders as "Stylized".
  const scaleLabel = scale?.name === "Realistic" ? "Real" : "Stylized";

  // Portals to document.body so the sheet sits at the same stacking level as
  // the vaul body sheet (z-40 control over z-30 body). Mobile chrome only ever
  // renders client-side (gated behind useIsMobile), so document is defined; the
  // guard is defensive in case that gating ever changes.
  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      aria-label="Playback and view controls"
      className="glass-dock pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex flex-col text-text"
      style={{
        paddingBottom: BOTTOM_INSET,
        // Keep controls out of the side safe areas (landscape notch / rounded
        // corners). Zero in portrait, so the dock still spans edge to edge.
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      {/* Build a simulation: floats just above the sheet's top edge, anchored
          to the sheet itself so it rides along as the sheet grows and shrinks
          (including mid-animation). Stays in the one-handed thumb zone. */}
      {!buildFabHidden && (
        <button
          type="button"
          aria-label="Build simulation"
          data-tour={MOBILE_BUILD_TOUR_TARGET}
          onClick={onBuildClick}
          className="absolute grid h-14 w-14 place-items-center rounded-full border border-white/[0.08] text-accent transition-colors hover:text-hi"
          style={{
            top: -70, // 56px button + a 14px gap above the sheet
            right: "calc(1rem + env(safe-area-inset-right, 0px))",
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
      <button
        type="button"
        aria-label={expanded ? "Collapse controls" : "Expand controls"}
        aria-expanded={expanded}
        onClick={toggleExpanded}
        // Fixed 30px: matches the old grab-handle's height exactly so the
        // collapsed peek's transport bar (in the fixed 96px sheet) is not pushed
        // down and clipped. The taller chevron box must not change this height.
        className="flex h-[30px] w-full shrink-0 items-center justify-center"
      >
        {/* A chevron, not a drag grab-handle: this sheet toggles on tap. Points
            up to expand when collapsed, flips down to collapse when open. */}
        <svg
          width="20"
          height="20"
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

      {/* Expanded controls. The 0fr -> 1fr grid row is what animates the
          sheet between its collapsed peek and a content-hugging expanded
          height; the inner row clips during the transition. inert when
          collapsed keeps the hidden controls out of the tab order and the
          accessibility tree. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div inert={!expanded} className="min-h-0 overflow-hidden">
          {/* Cap so a short landscape viewport scrolls instead of pushing the
              transport bar off-screen. */}
          <div
            className="space-y-4 overflow-y-auto px-4 pb-2"
            style={{ maxHeight: "55dvh" }}
          >
            {/* View controls only: body selection lives in the planet rail at
                the top of the screen, and with a single section an eyebrow
                heading would just cost a row. */}
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <Chip label="Orbits" on={showOrbits} onClick={() => dispatch(toggleShowOrbitPaths())} />
                <Chip label="Labels" on={showLabels} onClick={() => dispatch(toggleShowPlanetInfoOverlay())} />
                <Chip label="Trails" on={showTrails} onClick={() => dispatch(toggleShowTrails())} />
                <Chip
                  label="Drift"
                  on={drift}
                  busy={drift && driftBusy}
                  onClick={() => dispatch(setOverlayEnabled(!drift))}
                />
              </div>
              <Chip label="Scale" value={scaleLabel} onClick={() => dispatch(cycleSimulationScale())} />
            </div>
          </div>
        </div>
      </div>
    </section>,
    document.body,
  );
}
