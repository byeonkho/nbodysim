"use client";

import { useSelector } from "react-redux";
import {
  selectCelestialBodyPropertiesList,
  selectLastSimRequest,
} from "@/app/store/slices/SimulationSlice";
import { formatTimeStep } from "@/app/utils/dateMath";

// Configuration chip — secondary entrypoint to the SimSetup drawer.
// Inline summary of the current sim params (frame · integrator · Δt ·
// bodies count). Whole chip is one button; clicking opens the drawer
// (same handler as the primary CTA). Faint indigo bottom border hints
// clickability without competing with the primary CTA. Replaces the
// three separate Frame/Integrator/Δt cells from the prior layout.

interface ConfigurationChipProps {
  onClick: () => void;
}

export function ConfigurationChip({ onClick }: ConfigurationChipProps) {
  const lastReq = useSelector(selectLastSimRequest);
  const bodies = useSelector(selectCelestialBodyPropertiesList);

  const frameDisplay = lastReq?.frame ?? "—";
  const integratorDisplay = (lastReq?.integrator ?? "—").toUpperCase();
  const deltaTDisplay = lastReq ? formatTimeStep(lastReq.timeStepUnit) : "—";
  const bodiesDisplay = String(bodies?.length ?? 0);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open sim setup"
      className="group flex h-full items-center gap-2.5 border-r border-white/[0.06] px-3.5 transition-colors hover:bg-white/[0.02]"
      style={{
        borderBottom: "1px solid rgba(164,168,255,0.18)",
      }}
    >
      <span className="eyebrow self-center">Config</span>
      <span className="tabular self-center font-mono text-[11px]">
        <ChipPair label="Frame" value={frameDisplay} />
        <Sep />
        <ChipPair label="Integrator" value={integratorDisplay} accent />
        <Sep />
        <ChipPair label="Δt" value={deltaTDisplay} />
        <Sep />
        <ChipPair label="Bodies" value={bodiesDisplay} />
      </span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-dim group-hover:text-hi self-center transition-colors"
        aria-hidden
      >
        <path d="M2 3.5l3 3 3-3" />
      </svg>
    </button>
  );
}

function ChipPair({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <>
      <span className="text-dim">{label}: </span>
      <span className={accent ? "text-accent" : "text-hi"}>{value}</span>
    </>
  );
}

function Sep() {
  return <span className="text-subdim mx-2">·</span>;
}
