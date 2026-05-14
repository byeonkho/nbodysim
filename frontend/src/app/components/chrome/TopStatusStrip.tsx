"use client";

import { useSelector } from "react-redux";
import {
  selectCurrentTimeStepIndex,
  selectCurrentTimeStepIsoString,
  selectLastSimRequest,
  selectTotalTimeSteps,
} from "@/app/store/slices/SimulationSlice";
import {
  formatJD,
  isoToDateOrNull,
  julianDate,
} from "@/app/utils/dateMath";
import { FpsValue } from "@/app/components/chrome/FpsValue";
import { SimSetupButton } from "@/app/components/chrome/SimSetupButton";
import { ConfigurationChip } from "@/app/components/chrome/ConfigurationChip";

// Top glass strip — the SimSetup CTA leads, followed by the
// Configuration chip (collapsed Frame / Integrator / Δt / Bodies
// summary that opens the same drawer). UTC + JD come from the active
// timestep key; BUFFER from the buffered-vs-played delta; FPS from a
// self-contained RAF loop.

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

interface TopStatusStripProps {
  onSimSetupClick: () => void;
  simSetupActive: boolean;
}

export function TopStatusStrip({
  onSimSetupClick,
  simSetupActive,
}: TopStatusStripProps) {
  const utcKey = useSelector(selectCurrentTimeStepIsoString);
  const lastReq = useSelector(selectLastSimRequest);
  const total = useSelector(selectTotalTimeSteps);
  const idx = useSelector(selectCurrentTimeStepIndex);

  const utcDate = isoToDateOrNull(utcKey);
  const jdStr = utcDate ? formatJD(julianDate(utcDate)) : "—";

  const buffered = Math.max(0, total - idx);
  const bufferedStr = buffered.toLocaleString("en-US");

  // Pulse the Sim setup CTA only until the user has run their first sim.
  // lastRequest is the canonical "have they configured + Run yet?" signal —
  // set on submit, persisted across chunk fetches, never re-cleared.
  const showPulse = lastReq === null;

  return (
    <div
      className="glass pointer-events-auto absolute top-[18px] right-6 left-6 flex h-[46px] items-stretch overflow-hidden p-0"
      style={{ borderRadius: 12 }}
    >
      <SimSetupButton
        active={simSetupActive}
        showPulse={showPulse}
        onClick={onSimSetupClick}
      />

      <ConfigurationChip onClick={onSimSetupClick} />

      <StatusCell label="UTC" value={formatUtc(utcKey)} />
      <StatusCell label="JD" value={jdStr} />

      <div className="flex-1" />

      <StatusCell label="Buffer" value={bufferedStr} />
      <StatusCellWith label="FPS">
        <FpsValue className="text-success" />
      </StatusCellWith>
    </div>
  );
}
