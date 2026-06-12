"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  cycleSimulationScale,
  selectCameraPreset,
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
  toggleCameraPreset,
  togglePause,
  toggleShowAxes,
  toggleShowGrid,
  toggleShowOrbitPaths,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
} from "@/app/store/slices/SimulationSlice";
import { formatTPlus, isoToDateOrNull } from "@/app/utils/dateMath";
import { formatSpeed } from "@/app/utils/formatSpeed";
import {
  setOverlayEnabled,
  selectOverlayEnabled,
  selectGroundTruthFetchInFlight,
} from "@/app/store/slices/GroundTruthSlice";
import { DRIFT_CHIP_TOOLTIP } from "@/app/constants/driftTooltipCopy";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import {
  TOGGLE_BUTTON_CLASS,
  ToggleContent,
  toggleTone,
  VIEW_TOGGLE_ICONS,
} from "@/app/components/chrome/ViewToggleIcons";
import {
  AXES_COPY,
  GRID_COPY,
  LABELS_COPY,
  SCALE_COPY,
  TIMELINE_STEPS_COPY,
  TPLUS_COPY,
} from "@/app/constants/glossaryTooltipCopy";

// Bottom timeline: transport + rate + scrubber + view toggles. Replaces
// TimeControls.tsx + MiscActionBar.tsx + ControlsContainer.tsx. Scrubber
// is click-to-jump in this commit; drag + keyboard shortcuts come in a
// follow-up. Tick labels and T+ days are placeholders until Phase 2 (#58)
// surfaces JD / window math.

export function Timeline() {
  return (
    <div
      data-tour="timeline"
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
        <svg width="20" height="20" viewBox="0 0 18 18" fill="currentColor">
          <path d="M15 4L9 9L15 14ZM9 4L3 9L9 14Z" />
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
        <svg width="20" height="20" viewBox="0 0 18 18" fill="currentColor">
          <path d="M3 4L9 9L3 14ZM9 4L15 9L9 14Z" />
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
        <span className="eyebrow inline-flex items-center gap-1">
          TIMELINE · {total} STEPS
          <InfoTooltip label="What is the timeline?">
            {TIMELINE_STEPS_COPY}
          </InfoTooltip>
        </span>
        <span className="eyebrow inline-flex items-center gap-1">
          EPOCH J2000 · {tPlus}
          <InfoTooltip label="What does the elapsed time mean?">
            {TPLUS_COPY}
          </InfoTooltip>
        </span>
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
  const cameraPreset = useSelector(selectCameraPreset);
  const drift = useSelector(selectOverlayEnabled);
  // Only meaningful while the overlay is on; flips rarely (per fetch), so a
  // plain subscription is fine here (chip row is prep, not the render loop).
  const driftBusy = useSelector(selectGroundTruthFetchInFlight);

  // Camera preset is a binary viewpoint toggle (top-down vs free orbit),
  // grouped here with the other view controls. Shown as a value chip
  // (like Scale) since neither state is "off".
  const cameraLabel = cameraPreset === "top-down" ? "Top" : "Free";

  // Real = physically accurate ratios (bodies are dots, outer system
  // far off-screen at default zoom). Stylized = log1p radial compression
  // + power-law body radii so the whole solar system fits in one view
  // with every planet visibly distinct.
  const scaleLabel = scale.name === "Realistic" ? "Real" : "Stylized";

  return (
    // Fixed width so the row doesn't grow when the Scale caption changes
    // length (e.g. "Real" vs "Stylized"). Without this, the flex-1 Scrubber
    // sibling shifts in response to content length, which reads as the whole
    // panel jittering. 400px gives each of the 8 equal-share items enough
    // room for the longest caption ("STYLIZED") with no truncation. On/off
    // toggles lead, the two mode toggles (value captions) close the row.
    <div className="flex w-[400px] shrink-0 justify-between gap-0.5">
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.trails}
        label="Trails"
        on={trails}
        onClick={() => dispatch(toggleShowTrails())}
        tooltip="The fading line behind each body, tracing where it has just been."
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.orbits}
        label="Orbits"
        on={orbits}
        onClick={() => dispatch(toggleShowOrbitPaths())}
        tooltip="The full loop each body would trace forever if no other body's gravity ever changed its path. Slowly shifts as nearby bodies tug on it."
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.labels}
        label="Labels"
        on={labels}
        onClick={() => dispatch(toggleShowPlanetInfoOverlay())}
        tooltip={LABELS_COPY}
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.axes}
        label="Axes"
        on={axes}
        onClick={() => dispatch(toggleShowAxes())}
        tooltip={AXES_COPY}
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.grid}
        label="Grid"
        on={grid}
        onClick={() => dispatch(toggleShowGrid())}
        tooltip={GRID_COPY}
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.drift}
        label="Drift"
        on={drift}
        busy={drift && driftBusy}
        onClick={() => dispatch(setOverlayEnabled(!drift))}
        tooltip={DRIFT_CHIP_TOOLTIP}
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.scale}
        label="Scale"
        value={scaleLabel}
        onClick={() => dispatch(cycleSimulationScale())}
        tooltip={SCALE_COPY}
      />
      <ToggleChip
        icon={VIEW_TOGGLE_ICONS.camera}
        label="Camera"
        value={cameraLabel}
        onClick={() => dispatch(toggleCameraPreset())}
        tooltip="Switches between a straight-down map view and a free view you can orbit around the scene."
      />
    </div>
  );
}

// Stable subscribe for useSyncExternalStore — never re-fires. Mirrors
// the gating pattern in InfoTooltip: false on SSR, true post-hydration,
// so createPortal only runs once document.body is available.
const noopSubscribe = () => () => {};

function ToggleChip({
  icon,
  label,
  on,
  busy,
  value,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  on?: boolean;
  /** Pulses the icon while the chip's data is still loading. */
  busy?: boolean;
  value?: string;
  onClick: () => void;
  /** Optional plain-English description shown above the chip on hover/focus. */
  tooltip?: string;
}) {
  const hasValue = value !== undefined;

  // Tooltip mechanics mirror InfoTooltip: portal into document.body to
  // escape every ancestor's stacking context / overflow / backdrop-filter;
  // positioned from the chip's bounding rect on each open.
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const tooltipWidth = 256; // matches w-64
    const gap = 8;
    const margin = 8;
    // Clamp into the viewport (mirrors InfoTooltip) so the rightmost view
    // chips don't bleed off the right edge.
    const rawLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
    const left = Math.max(
      margin,
      Math.min(rawLeft, window.innerWidth - tooltipWidth - margin),
    );
    setCoords({
      left,
      top: rect.top - gap, // tooltip's BOTTOM sits here; translateY(-100%) flips it above
    });
  }, [open]);

  const tooltipHandlers = tooltip
    ? {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      }
    : {};

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        aria-pressed={hasValue ? undefined : Boolean(on)}
        aria-label={hasValue ? `${label}: ${value}` : undefined}
        aria-describedby={tooltip && open ? tooltipId : undefined}
        {...tooltipHandlers}
        className={`${TOGGLE_BUTTON_CLASS} ${toggleTone(hasValue, Boolean(on))}`}
      >
        <ToggleContent
          icon={icon}
          label={label}
          on={on}
          value={value}
          busy={busy}
        />
      </button>
      {tooltip &&
        mounted &&
        coords &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="text-hi pointer-events-none fixed z-50 w-64 rounded-md border border-white/[0.08] px-3 py-2 text-[11px] leading-[1.5] shadow-lg transition-opacity duration-150"
            style={{
              background: "rgba(10, 12, 20, 0.96)",
              left: coords.left,
              top: coords.top,
              opacity: open ? 1 : 0,
              transform: "translateY(-100%)",
            }}
          >
            {tooltip}
          </div>,
          document.body,
        )}
    </>
  );
}
