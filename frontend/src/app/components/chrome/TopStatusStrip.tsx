"use client";

import { useSelector } from "react-redux";
import {
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepIndex,
  selectCurrentTimeStepKey,
  selectLastSimRequest,
  selectTotalTimeSteps,
} from "@/app/store/slices/SimulationSlice";
import {
  formatJD,
  formatTimeStep,
  isoToDateOrNull,
  julianDate,
} from "@/app/utils/dateMath";
import { FpsValue } from "@/app/components/chrome/FpsValue";

// Top glass strip telemetry. Frame / Integrator / Δt come from the
// most-recent SimParams submission (selectLastSimRequest); UTC + JD
// from the active timestep key; Bodies from the props list; BUFFER
// from the buffered-vs-played delta; FPS from a self-contained RAF
// loop. Cells render as static text or one of two helper components.

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

function StatusCellWith({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-baseline gap-1.5 border-r border-white/[0.06] px-3.5">
      <span className="eyebrow self-center">{label}</span>
      <span className="tabular text-hi self-center font-mono text-[11px]">
        {children}
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
  const utcKey = useSelector(selectCurrentTimeStepKey);
  const bodies = useSelector(selectCelestialBodyPropertiesList);
  const lastReq = useSelector(selectLastSimRequest);
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);

  const utcDate = isoToDateOrNull(utcKey);
  const jdStr = utcDate ? formatJD(julianDate(utcDate)) : "—";

  const frameDisplay = lastReq?.frame ?? "—";
  const integratorDisplay = (lastReq?.integrator ?? "—").toUpperCase();
  const deltaTDisplay = lastReq ? formatTimeStep(lastReq.timeStepUnit) : "—";

  const buffered = Math.max(0, total - idx);
  const bufferedStr = buffered.toLocaleString("en-US");

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

      <StatusCell label="UTC" value={formatUtc(utcKey)} />
      <StatusCell label="JD" value={jdStr} />
      <StatusCell label="Frame" value={frameDisplay} />
      <StatusCell
        label="Integrator"
        value={integratorDisplay}
        valueClass="text-accent"
      />
      <StatusCell label="Δt" value={deltaTDisplay} />

      <div className="flex-1" />

      <StatusCell label="Bodies" value={String(bodies?.length ?? 0)} />
      <StatusCell label="Buffer" value={bufferedStr} />
      <StatusCellWith label="FPS">
        <FpsValue className="text-success" />
      </StatusCellWith>
    </div>
  );
}
