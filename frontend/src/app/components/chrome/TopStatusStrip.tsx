"use client";

import { useEffect, useRef } from "react";
import { useSelector, useStore } from "react-redux";
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
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import { readDeltaERelativeAt } from "@/app/store/chunkBuffer";
import { formatDeltaE } from "@/app/utils/helpers";
import { RESIDUAL_CONCEPT_COPY } from "@/app/constants/residualTooltipCopy";
import type { RootState } from "@/app/store/Store";

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

  const buffered = Math.max(0, total - Math.floor(idx));
  const bufferedStr = buffered.toLocaleString("en-US");

  // ΔE/E₀ cell — ref-based 5 Hz polling, not useSelector-per-frame.
  // The other strip cells re-render every frame via useSelector on the
  // current timestep; deliberately skipping that pattern here keeps a new
  // per-frame React subscription off the strip for a glanceable readout.
  const store = useStore<RootState>();
  const deltaERef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      const state = store.getState();
      const buffer = state.simulation.chunkBuffer;
      if (!buffer || !deltaERef.current) return;
      // currentTimeStepIndex is buffer-relative — the slice decrements
      // it on eviction (SimulationSlice.appendChunkToBuffer shifts the
      // play head left by `shifted`). No need to subtract bufferStartTimestep.
      const playIdx = state.simulation.timeState.currentTimeStepIndex;
      deltaERef.current.textContent = formatDeltaE(
        readDeltaERelativeAt(buffer, playIdx),
      );
    };
    const id = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(id);
  }, [store]);

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

      <div className="flex h-full items-baseline gap-1.5 border-r border-white/[0.06] px-3.5">
        <span className="eyebrow inline-flex items-center gap-1 self-center">
          ΔE/E₀
          <InfoTooltip label="What is ΔE/E₀?">
            {RESIDUAL_CONCEPT_COPY}
          </InfoTooltip>
        </span>
        <span
          ref={deltaERef}
          className="tabular text-hi self-center font-mono text-[11px]"
        >
          —
        </span>
      </div>

      <StatusCell label="Buffer" value={bufferedStr} />
      <StatusCellWith label="FPS">
        <FpsValue className="text-success" />
      </StatusCellWith>
    </div>
  );
}
