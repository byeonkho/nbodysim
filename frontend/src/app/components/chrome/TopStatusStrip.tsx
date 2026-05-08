"use client";

import { useSelector } from "react-redux";
import {
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
} from "@/app/store/slices/SimulationSlice";

// Top glass strip: telemetry cells per the design handoff. Phase 1 ships
// real values for UTC + Bodies and static placeholders for Frame /
// Integrator / Δt / FPS. Phase 2 (todo #58) wires JD, BUFFER, and
// surfaces the chosen frame/integrator/Δt to Redux.
//
// The strip handles its own absolute positioning; it lives inside
// Layout.tsx's pointer-events:none overlay container, but opts itself in
// to interactivity via pointer-events-auto.

function StatusCell({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex h-full items-baseline gap-1.5 border-r border-white/[0.06] px-3.5">
      <span className="eyebrow self-center">{label}</span>
      <span
        className={`tabular self-center font-mono text-[11px] ${valueClass ?? "text-hi"}`}
      >
        {value}
      </span>
    </div>
  );
}

function formatUtc(iso: string): string {
  if (!iso) return "—";
  const [date, time = ""] = iso.split("T");
  return `${date} ${time}`.trim();
}

export function TopStatusStrip() {
  const utc = useSelector(selectCurrentTimeStepKey);
  const bodies = useSelector(selectCelestialBodyPropertiesList);

  return (
    <div
      className="glass pointer-events-auto absolute top-[18px] right-6 left-6 flex h-[42px] items-stretch overflow-hidden p-0"
      style={{ borderRadius: 12 }}
    >
      <div className="flex items-center gap-2.5 border-r border-white/[0.06] px-4">
        <span
          className="block h-[22px] w-[22px] rounded-md"
          style={{
            background:
              "linear-gradient(135deg, var(--color-accent), var(--color-accent-grad-end))",
            boxShadow: "0 4px 14px rgba(164,168,255,0.4)",
          }}
        />
        <span className="text-hi text-[13px] font-semibold tracking-[-0.01em]">
          spacesim
        </span>
      </div>

      <StatusCell label="UTC" value={formatUtc(utc)} />
      <StatusCell label="Frame" value="Heliocentric" />
      <StatusCell label="Integrator" value="RK4" valueClass="text-accent" />
      <StatusCell label="Δt" value="3600 s" />

      <div className="flex-1" />

      <StatusCell label="Bodies" value={String(bodies?.length ?? 0)} />
      <StatusCell label="FPS" value="—" valueClass="text-success" />
    </div>
  );
}
