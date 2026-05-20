"use client";

import { useState, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  cycleSimulationScale,
  selectCurrentTimeStepIndex,
  selectCurrentTimeStepIsoString,
  selectIsPaused,
  selectShowAxes,
  selectShowGrid,
  selectShowOrbitPaths,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
  selectSpeedMultiplier,
  selectTotalTimeSteps,
  setCurrentTimeStepIndex,
  setSpeedMultiplier,
  togglePause,
  toggleShowAxes,
  toggleShowGrid,
  toggleShowOrbitPaths,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
} from "@/app/store/slices/SimulationSlice";
import { formatTPlus, isoToDateOrNull } from "@/app/utils/dateMath";

// Bottom timeline: transport + rate + scrubber + view toggles. Replaces
// TimeControls.tsx + MiscActionBar.tsx + ControlsContainer.tsx. Scrubber
// is click-to-jump in this commit; drag + keyboard shortcuts come in a
// follow-up. Tick labels and T+ days are placeholders until Phase 2 (#58)
// surfaces JD / window math.

export function Timeline() {
  return (
    <div
      className="glass pointer-events-auto absolute right-6 bottom-[18px] left-6 flex items-center gap-[18px] px-[18px] py-[14px]"
      style={{ borderRadius: 14 }}
    >
      <Transport />
      <Hairline />
      <RateReadout />
      <Scrubber />
      <Hairline />
      <ViewToggles />
    </div>
  );
}

function Hairline() {
  return <div className="h-[30px] w-px bg-white/[0.08]" />;
}

// ── Transport ──────────────────────────────────────────────────────────

function Transport() {
  const dispatch = useDispatch();
  const isPaused = useSelector(selectIsPaused);

  return (
    <div className="flex items-center gap-1.5">
      <TransportButton
        onClick={() => dispatch(setSpeedMultiplier("decrease"))}
        ariaLabel="Decrease speed"
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor">
          <path d="M5 4l-2 2 2 2M9 4l-2 2 2 2" />
        </svg>
      </TransportButton>

      <TransportButton
        primary
        onClick={() => dispatch(togglePause())}
        ariaLabel={isPaused ? "Play" : "Pause"}
      >
        {isPaused ? (
          <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor">
            <path d="M5 3l10 6-10 6V3z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor">
            <rect x="4" y="3" width="3" height="12" />
            <rect x="11" y="3" width="3" height="12" />
          </svg>
        )}
      </TransportButton>

      <TransportButton
        onClick={() => dispatch(setSpeedMultiplier("increase"))}
        ariaLabel="Increase speed"
      >
        <svg width="14" height="14" viewBox="0 0 18 18" fill="currentColor">
          <path d="M3 4l2 2-2 2M7 4l2 2-2 2" />
        </svg>
      </TransportButton>
    </div>
  );
}

function TransportButton({
  children,
  onClick,
  primary,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={[
        "grid h-9 w-9 place-items-center rounded-[10px] transition-colors",
        primary
          ? "text-bg"
          : "text-text bg-white/[0.05] hover:bg-white/[0.08]",
      ].join(" ")}
      style={
        primary
          ? {
              background:
                "linear-gradient(135deg, var(--color-accent), var(--color-accent-grad-end))",
              boxShadow: "0 6px 16px rgba(164,168,255,0.35)",
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

// ── Rate ───────────────────────────────────────────────────────────────

function RateReadout() {
  const speed = useSelector(selectSpeedMultiplier);
  return (
    <div>
      <div className="eyebrow">RATE</div>
      <div className="mt-px flex items-baseline gap-[3px]">
        <span className="text-hi tabular font-mono text-[22px] leading-none font-medium">
          {formatSpeed(speed)}
        </span>
        <span className="text-dim text-[10px]">×</span>
      </div>
    </div>
  );
}

function formatSpeed(speed: number): string {
  if (!Number.isFinite(speed)) return "0.00";
  const abs = Math.abs(speed);
  if (abs >= 100) return Math.round(speed).toString();
  if (abs >= 10) return speed.toFixed(1);
  return speed.toFixed(2);
}

// ── Scrubber ───────────────────────────────────────────────────────────

const TICK_COUNT = 25;

function Scrubber() {
  const dispatch = useDispatch();
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);
  const utcKey = useSelector(selectCurrentTimeStepIsoString);
  const trackRef = useRef<HTMLDivElement>(null);

  const progress = total > 1 ? idx / (total - 1) : 0;
  const utcDate = isoToDateOrNull(utcKey);
  const tPlus = utcDate ? formatTPlus(utcDate) : "T+— d";

  const seek = (clientX: number) => {
    if (!trackRef.current || total <= 1) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    dispatch(setCurrentTimeStepIndex(Math.round(ratio * (total - 1))));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.buttons & 1) seek(e.clientX);
  };

  return (
    <div className="flex-1 px-2">
      <div className="mb-1.5 flex justify-between">
        <span className="eyebrow">TIMELINE · {total} STEPS</span>
        <span className="eyebrow">EPOCH J2000 · {tPlus}</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        className="relative h-8 cursor-pointer touch-none select-none"
      >
        <svg
          width="100%"
          height="32"
          className="pointer-events-none absolute inset-0 overflow-visible"
        >
          <line
            x1="0"
            y1="14"
            x2="100%"
            y2="14"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
          {Array.from({ length: TICK_COUNT }).map((_, i) => {
            const major = i % 6 === 0;
            const x = `${(i / (TICK_COUNT - 1)) * 100}%`;
            return (
              <line
                key={i}
                x1={x}
                y1={major ? 7 : 11}
                x2={x}
                y2="14"
                stroke={major ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"}
              />
            );
          })}
          <rect
            x="0"
            y="13"
            width={`${progress * 100}%`}
            height="2"
            fill="url(#timelineGrad)"
            rx="1"
          />
          <defs>
            <linearGradient id="timelineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="rgba(164,168,255,0.25)" />
              <stop offset="1" stopColor="var(--color-accent)" />
            </linearGradient>
          </defs>
        </svg>
        <div
          className="pointer-events-none absolute top-1.5 flex flex-col items-center"
          style={{ left: `${progress * 100}%`, transform: "translateX(-50%)" }}
        >
          <div
            className="h-[11px] w-[11px] rounded-full bg-white"
            style={{
              boxShadow:
                "0 0 0 3px rgba(164,168,255,0.45), 0 2px 8px rgba(0,0,0,0.4)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── View toggles ───────────────────────────────────────────────────────

function ViewToggles() {
  const dispatch = useDispatch();
  const grid = useSelector(selectShowGrid);
  const trails = useSelector(selectShowTrails);
  const orbits = useSelector(selectShowOrbitPaths);
  const labels = useSelector(selectShowPlanetInfoOverlay);
  const axes = useSelector(selectShowAxes);
  const scale = useSelector(selectSimulationScale);

  // Local-only toggle for now. Phase 2 (#58) decides what Info gates —
  // candidates: master toggle for the right column, or in-scene labels.
  const [info, setInfo] = useState(true);

  // Real = physically accurate ratios (bodies are dots, outer system
  // far off-screen at default zoom). Stylized = log1p radial compression
  // + power-law body radii so the whole solar system fits in one view
  // with every planet visibly distinct.
  const scaleLabel = scale.name === "Realistic" ? "Real" : "Stylized";

  return (
    // Fixed width so the chip grid doesn't grow when the Scale chip's
    // value changes length (e.g. "Real" vs "Stylized"). Without this,
    // the flex-1 Scrubber sibling shifts in response to chip content
    // length, which reads as the whole panel jittering. 290px comfortably
    // holds the longest expected value across all 7 chips.
    <div className="grid grid-cols-3 gap-[5px] w-[290px] shrink-0">
      <ToggleChip label="Grid" on={grid} onClick={() => dispatch(toggleShowGrid())} />
      <ToggleChip label="Trails" on={trails} onClick={() => dispatch(toggleShowTrails())} />
      <ToggleChip
        label="Orbits"
        on={orbits}
        onClick={() => dispatch(toggleShowOrbitPaths())}
      />
      <ToggleChip
        label="Labels"
        on={labels}
        onClick={() => dispatch(toggleShowPlanetInfoOverlay())}
      />
      <ToggleChip label="Axes" on={axes} onClick={() => dispatch(toggleShowAxes())} />
      <ToggleChip
        label="Scale"
        value={scaleLabel}
        onClick={() => dispatch(cycleSimulationScale())}
      />
      <ToggleChip
        label="Info"
        value={info ? "ON" : "OFF"}
        onClick={() => setInfo((p) => !p)}
      />
    </div>
  );
}

function ToggleChip({
  label,
  on,
  value,
  onClick,
}: {
  label: string;
  on?: boolean;
  value?: string;
  onClick: () => void;
}) {
  const hasValue = value !== undefined;
  const lit = hasValue ? value !== "OFF" : Boolean(on);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={hasValue ? undefined : Boolean(on)}
      className={[
        // w-full + justify-between: chip fills its grid cell; label sticks
        // to the left, value sticks to the right. Stable column widths
        // regardless of value text length. min-w-0 lets the spans truncate
        // if absolutely needed rather than blowing out the cell.
        "flex w-full min-w-0 items-center justify-between gap-1.5 rounded-[7px] border px-[9px] py-[5px] text-[10px] font-medium transition-colors",
        lit
          ? "bg-[rgba(164,168,255,0.12)] border-[rgba(164,168,255,0.28)] text-accent"
          : "bg-white/[0.04] border-white/[0.06] text-[#9b9ea9] hover:bg-white/[0.06]",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <span className="tabular truncate font-mono text-[9px] opacity-70">
        {hasValue ? value : lit ? "●" : "○"}
      </span>
    </button>
  );
}
