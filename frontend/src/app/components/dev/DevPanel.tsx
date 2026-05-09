"use client";

import { useSelector } from "react-redux";
import {
  selectCurrentTimeStepIndex,
  selectSimulationDataSize,
  selectTotalTimeSteps,
} from "@/app/store/slices/SimulationSlice";
import {
  getDevSettings,
  setDevSetting,
  useDevSettings,
  type DevSettings,
} from "@/app/dev/devSettingsStore";

// Dev-only panel — mounted only when the URL has ?dev=1 (Decision 9 in
// design.md). Re-styled to match the redesign palette: glass surface,
// eyebrow labels, mono numerics. Holds the chunk-buffer metrics and
// camera tunable sliders previously hosted in MiniDrawer.
//
// Not part of the user-facing flow; safe to delete if dev tooling
// migrates elsewhere.

export function DevPanel() {
  return (
    <div
      className="glass pointer-events-auto absolute right-6 bottom-[140px] z-20 flex w-[280px] flex-col gap-2 p-4"
      style={{ borderRadius: 14 }}
    >
      <div className="text-hi text-[12px] font-semibold tracking-[-0.01em]">
        Dev panel
      </div>
      <p className="text-subdim text-[10px] tracking-[0.04em] uppercase">
        ?dev=1
      </p>

      <DevMetrics />
      <CameraSliders />
    </div>
  );
}

function DevMetrics() {
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);
  const remaining = Math.max(0, total - idx);
  const bytes = useSelector(selectSimulationDataSize);

  return (
    <section className="mt-1 flex flex-col gap-1.5 border-t border-dashed border-white/[0.06] pt-2.5">
      <p className="eyebrow">CHUNK BUFFER</p>
      <Row k="Total steps" v={total.toLocaleString("en-US")} />
      <Row k="Current step" v={idx.toLocaleString("en-US")} />
      <Row k="Remaining" v={remaining.toLocaleString("en-US")} />
      <Row k="Payload size" v={formatBytes(bytes)} />
    </section>
  );
}

function CameraSliders() {
  const settings = useDevSettings();

  return (
    <section className="flex flex-col gap-3 border-t border-dashed border-white/[0.06] pt-2.5">
      <p className="eyebrow">CAMERA TUNABLES</p>
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
    </section>
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

// Quiet a "no-unused" if getDevSettings becomes used elsewhere.
void getDevSettings;
