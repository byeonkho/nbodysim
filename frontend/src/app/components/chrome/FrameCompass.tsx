"use client";

import { useDispatch, useSelector } from "react-redux";
import {
  cycleDisplayFrame,
  selectDisplayFrame,
} from "@/app/store/slices/SimulationSlice";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import { FRAME_COMPASS_COPY } from "@/app/constants/glossaryTooltipCopy";

// Frame compass widget. Clicking cycles the display frame (helio → geo →
// helio) and triggers the per-frame pivot transform applied in Sphere.tsx
// and Trail.tsx — instant switch, no buffer reload, because the backend
// always emits Sun-relative snapshots regardless of integration frame.
//
// Helio: Sun anchored at origin; planets sweep their orbits.
// Geo:   Earth anchored at origin; Sun and outer planets sweep around
//        Earth, Mars exhibits retrograde loop motion.
//
// Bary deferred — see DisplayFrame type comment in SimulationSlice.

const FRAME_LABELS: Record<"helio" | "geo", string> = {
  helio: "Heliocentric",
  geo: "Geocentric",
};

export function FrameCompass() {
  const dispatch = useDispatch();
  const frame = useSelector(selectDisplayFrame);
  const label = FRAME_LABELS[frame];

  const onClick = () => {
    dispatch(cycleDisplayFrame());
  };

  // Schematic glyph in the compass changes with frame so the UI hints
  // at "what's pinned at origin": ☉ for helio, ⊕ (Earth symbol) for geo.
  const centerGlyph = frame === "helio" ? "☉" : "⊕";
  const centerColor =
    frame === "helio" ? "var(--color-amber)" : "var(--color-body-earth)";

  return (
    <div
      data-tour="frame-compass"
      className="pointer-events-auto absolute top-[96px] left-6 w-24"
    >
      <span className="absolute top-1.5 right-1.5 z-10">
        <InfoTooltip label="What is the frame?" placement="below">
          {FRAME_COMPASS_COPY}
        </InfoTooltip>
      </span>
      <button
        type="button"
        onClick={onClick}
        className="glass block w-full px-3 py-2.5 text-center transition-colors hover:bg-white/[0.04]"
        style={{ borderRadius: 10 }}
        aria-label={`Cycle display frame (currently ${label})`}
      >
        <div className="eyebrow mb-1.5">FRAME</div>
        <svg
          width="64"
          height="64"
          viewBox="0 0 64 64"
          className="mx-auto block"
        >
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
          />
          <circle
            cx="32"
            cy="32"
            r="20"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
          />
          <line
            x1="32"
            y1="6"
            x2="32"
            y2="58"
            stroke="rgba(255,255,255,0.10)"
          />
          <line
            x1="6"
            y1="32"
            x2="58"
            y2="32"
            stroke="rgba(255,255,255,0.10)"
          />
          <text
            x="32"
            y="13"
            fontSize="8"
            fill="var(--color-dim)"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            +Y
          </text>
          <text
            x="58"
            y="35"
            fontSize="8"
            fill="var(--color-dim)"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            +X
          </text>
          <circle cx="32" cy="32" r="4" fill={centerColor} />
          <text
            x="32"
            y="50"
            fontSize="8"
            fill={centerColor}
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {centerGlyph}
          </text>
        </svg>
        <div className="text-hi mt-1 text-[10px] font-medium">{label}</div>
      </button>
    </div>
  );
}
