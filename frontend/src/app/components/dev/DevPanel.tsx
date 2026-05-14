"use client";

import { useState } from "react";
import { useSelector } from "react-redux";
import {
  selectChunkBuffer,
  selectCurrentTimeStepIndex,
  selectTotalTimeSteps,
} from "@/app/store/slices/SimulationSlice";
import { BYTES_PER_TIMESTEP_PER_BODY } from "@/app/store/chunkBuffer";
import {
  setDevSetting,
  useDevSettings,
  type DevSettings,
} from "@/app/dev/devSettingsStore";

// Dev-only panel — mounted only when the URL has ?dev=1 (Decision 9 in
// design.md). Re-styled to match the redesign palette: glass surface,
// eyebrow labels, mono numerics. Holds the chunk-buffer metrics, camera
// tunable sliders, and the trail-length tunable.
//
// Positioned bottom-left, right of the LeftRail and above the bottom
// timeline, so it never overlaps the right column (body card / event
// log). Collapsible via the chevron — collapsed state hides the body
// but keeps the header so re-expanding is a single click.

export function DevPanel() {
  const [expanded, setExpanded] = useState(true);
  return (
    <div
      className="glass pointer-events-auto absolute bottom-[130px] left-[100px] z-20 flex w-[280px] flex-col p-0"
      style={{ borderRadius: 14 }}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-hi text-[12px] font-semibold tracking-[-0.01em]">
            Dev panel
          </span>
          <span className="text-subdim text-[9px] tracking-[0.18em] uppercase">
            ?dev=1
          </span>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          className={`text-dim transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        >
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          <DevMetrics />
          <Tunables />
        </div>
      )}
    </div>
  );
}

function DevMetrics() {
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);
  const remaining = Math.max(0, total - idx);
  const buffer = useSelector(selectChunkBuffer);
  // Cheap O(1) calc — no JSON.stringify or Blob construction. Includes the
  // positions Float64Array (totalTimesteps × bodyCount × 48 bytes) and the
  // timestamps BigInt64Array (capacity × 8 bytes).
  const bytes = buffer
    ? buffer.totalTimesteps * buffer.bodyCount * BYTES_PER_TIMESTEP_PER_BODY +
      buffer.capacity * 8
    : 0;

  return (
    <section className="flex flex-col gap-1.5 border-t border-dashed border-white/[0.06] pt-2.5">
      <p className="eyebrow">CHUNK BUFFER</p>
      <Row k="Total steps" v={total.toLocaleString("en-US")} />
      <Row k="Current step" v={idx.toLocaleString("en-US")} />
      <Row k="Remaining" v={remaining.toLocaleString("en-US")} />
      <Row k="Payload size" v={formatBytes(bytes)} />
      {buffer && (
        <Row
          k="Capacity"
          v={`${buffer.capacity.toLocaleString("en-US")} steps`}
        />
      )}
    </section>
  );
}

function Tunables() {
  const settings = useDevSettings();

  return (
    <section className="flex flex-col gap-3 border-t border-dashed border-white/[0.06] pt-2.5">
      <p className="eyebrow">TUNABLES</p>
      <DevSlider
        label="Trail length"
        valueKey="trailLength"
        value={settings.trailLength}
        min={100}
        max={5000}
        step={100}
        format={(v) => Math.round(v).toLocaleString("en-US")}
      />
      <DevSlider
        label="Zoom sensitivity"
        valueKey="zoomSensitivity"
        value={settings.zoomSensitivity}
        min={0.0001}
        max={0.01}
        step={0.0001}
        format={(v) => v.toFixed(4)}
      />
      <DevSlider
        label="Orbit damping"
        valueKey="orbitDampingFactor"
        value={settings.orbitDampingFactor}
        min={0.001}
        max={0.2}
        step={0.001}
        format={(v) => v.toFixed(3)}
      />
      <DevSlider
        label="Tracking zoom lerp"
        valueKey="cameraZoomLerpRate"
        value={settings.cameraZoomLerpRate}
        min={0.01}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
      />
      <DevSegmented
        label="Skybox"
        value={settings.skyboxVariant}
        options={[
          { value: "full", label: "Full" },
          { value: "milkyway", label: "MW only" },
          { value: "stars", label: "Stars" },
        ]}
        onChange={(v) => setDevSetting("skyboxVariant", v)}
      />
    </section>
  );
}

function DevSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-dim text-[11px]">{label}</span>
      </div>
      <div className="flex gap-1 rounded-md border border-white/[0.06] p-0.5">
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`flex-1 rounded-sm px-2 py-1 text-[10px] font-medium tracking-[0.04em] uppercase transition-colors ${
                active
                  ? "bg-white/[0.08] text-hi"
                  : "text-dim hover:text-hi hover:bg-white/[0.03]"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DevSlider({
  label,
  valueKey,
  value,
  min,
  max,
  step,
  format,
}: {
  label: string;
  valueKey: keyof DevSettings;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-dim text-[11px]">{label}</span>
        <span className="tabular text-hi font-mono text-[11px]">
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) =>
          setDevSetting(valueKey, parseFloat(e.target.value))
        }
        className="dev-slider w-full"
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-dim text-[11px]">{k}</span>
      <span className="tabular text-hi font-mono text-[11px]">{v}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(2)} ${units[i] ?? "B"}`;
}
