"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import { BODY_DISPLAY, type BodyKey } from "@/app/constants/BodyVisuals";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";
import {
  FRAME_LABELS,
  DEFAULT_FRAME,
  INTEGRATORS,
  TIME_UNITS,
  type TimeUnit,
} from "@/app/constants/SimParams";
import {
  INTEGRATOR_DEFAULT_BUCKETS,
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";
import { PlaybackQualityPicker } from "@/app/components/chrome/PlaybackQualityPicker";
import { BodyCatalogPane } from "@/app/components/chrome/simSetup/BodyCatalogPane";
import { formatTimeStep } from "@/app/utils/dateMath";
import { runSimulation } from "@/app/utils/runSimulation";
import {
  EPOCH_COPY,
  REFERENCE_FRAME_COPY,
  INTEGRATOR_COPY,
  INTEGRATOR_HELP,
  TIME_STEP_COPY,
  PLAYBACK_QUALITY_COPY,
} from "@/app/constants/glossaryTooltipCopy";

// Inline tap-to-reveal field wrapper. The (i) button toggles an explanation
// paragraph directly below the control — no portal, no positioning needed on
// touch devices.
function Field({
  label,
  help,
  note,
  accent,
  children,
}: {
  label: string;
  /** Plain-English explanation revealed on tapping the (i) button. */
  help?: React.ReactNode;
  /** Persistent helper line shown inside the box, below the control. */
  note?: React.ReactNode;
  /** Accent treatment (used for the headline Integrator field). */
  accent?: boolean;
  children: React.ReactNode;
}) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={accent ? "eyebrow text-accent" : "eyebrow"}>{label}</span>
        {help != null && (
          <button
            type="button"
            aria-label={`What is ${label}?`}
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
            className="grid h-4 w-4 place-items-center rounded-full text-dim transition-colors hover:text-hi"
          >
            <span className="text-[10px] font-semibold">i</span>
          </button>
        )}
      </div>
      <div
        className={`rounded-lg border px-3 py-2.5 ${
          accent
            ? "border-[rgba(164,168,255,0.28)] bg-[rgba(164,168,255,0.06)]"
            : "border-white/[0.08] bg-white/[0.04]"
        }`}
      >
        {children}
        {note != null && (
          <p className="mt-1.5 text-[11px] leading-[1.4] text-dim">{note}</p>
        )}
      </div>
      {showHelp && help != null && (
        <p className="mt-1.5 px-0.5 text-[11px] leading-[1.5] text-dim">
          {help}
        </p>
      )}
    </div>
  );
}

interface MobileSimSetupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileSimSetupSheet({
  open,
  onOpenChange,
}: MobileSimSetupSheetProps) {
  const dispatch = useDispatch<AppDispatch>();

  const [selectedBodies, setSelectedBodies] = useState<Set<BodyKey>>(
    new Set(DEFAULT_SELECTED),
  );
  const [epoch, setEpoch] = useState("2024-06-05T00:00:00.000");
  const [frame, setFrame] = useState<string>(DEFAULT_FRAME);
  const [integrator, setIntegrator] = useState<string>("rk4");
  const [timeUnit, setTimeUnit] = useState<TimeUnit>("Hours");
  const [fidelityBucket, setFidelityBucket] = useState<FidelityBucket>(
    INTEGRATOR_DEFAULT_BUCKETS[integrator] ?? "medLow",
  );
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Reset the bucket to the new integrator's default when the integrator
  // changes. Guarded set-state-in-render (not useEffect) to satisfy the
  // repo's set-state-in-effect lint rule.
  const [prevIntegrator, setPrevIntegrator] = useState<string>(integrator);
  if (prevIntegrator !== integrator) {
    setPrevIntegrator(integrator);
    const def = INTEGRATOR_DEFAULT_BUCKETS[integrator];
    if (def) setFidelityBucket(def);
  }

  const toggleBody = (key: BodyKey) =>
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setMany = (keys: readonly BodyKey[], enable: boolean) =>
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (enable) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const setSelection = (keys: BodyKey[]) => setSelectedBodies(new Set(keys));

  const busy = submitMsg !== null;

  const handleRun = async () => {
    const celestialBodyNames = Array.from(selectedBodies).map(
      (k) => BODY_DISPLAY[k],
    );
    if (celestialBodyNames.length === 0 || busy) return;
    setSubmitMsg("Starting simulation...");
    try {
      const ok = await runSimulation(
        dispatch,
        {
          celestialBodyNames,
          date: epoch,
          frame,
          integrator,
          timeStepUnit: timeUnit,
          fidelityBucket,
        },
        {
          onRetry: () =>
            setSubmitMsg(
              "Waking up the simulator, this can take a few seconds...",
            ),
        },
      );
      if (ok) onOpenChange(false);
    } finally {
      setSubmitMsg(null);
    }
  };

  // Mount guard: vaul renders server-side and the portal needs document.
  if (typeof document === "undefined") return null;

  const selectClass =
    "w-full appearance-none bg-transparent text-sm text-hi outline-none";

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[45] bg-black/50" />
        <Drawer.Content
          aria-describedby={undefined}
          className="glass-dock pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col text-text"
        >
          <Drawer.Handle className="my-2 shrink-0" />

          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-white/[0.06] px-5 pb-4 pt-1">
            <div>
              <p className="eyebrow text-accent" style={{ letterSpacing: "0.22em" }}>
                Simulation parameters
              </p>
              <Drawer.Title className="mt-1 text-lg font-semibold tracking-tight text-hi">
                Configure simulation
              </Drawer.Title>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03] text-dim hover:text-hi"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              >
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>

          {/* Scrolling body */}
          <div className="flex-1 overflow-y-auto px-5 pt-5">
            {/* Epoch */}
            <Field label="Epoch" help={EPOCH_COPY}>
              <input
                type="datetime-local"
                step="0.001"
                value={epoch}
                onChange={(e) => setEpoch(e.target.value)}
                className="w-full bg-transparent font-mono text-sm text-hi tabular outline-none"
                style={{ colorScheme: "dark" }}
              />
            </Field>

            {/* Reference frame */}
            <Field label="Reference frame" help={REFERENCE_FRAME_COPY}>
              <select
                value={frame}
                onChange={(e) => setFrame(e.target.value)}
                className={selectClass}
                style={{ colorScheme: "dark" }}
              >
                {FRAME_LABELS.map((f) => (
                  <option key={f} value={f} className="bg-bg">
                    {f}
                  </option>
                ))}
              </select>
            </Field>

            {/* Integrator (accent-highlighted: the headline numerical-engine knob) */}
            <Field accent label="Integrator" help={INTEGRATOR_COPY} note={INTEGRATOR_HELP}>
              <select
                value={integrator}
                onChange={(e) => setIntegrator(e.target.value)}
                className="w-full appearance-none bg-transparent text-sm font-medium text-accent outline-none"
                style={{ colorScheme: "dark" }}
              >
                {INTEGRATORS.map(([v, l]) => (
                  <option key={v} value={v} className="bg-bg font-normal text-hi">
                    {l}
                  </option>
                ))}
              </select>
            </Field>

            {/* Time unit + delta-t */}
            <Field label="Time step" help={TIME_STEP_COPY}>
              <div className="flex items-center gap-3">
                <select
                  value={timeUnit}
                  onChange={(e) => setTimeUnit(e.target.value as TimeUnit)}
                  className={`${selectClass} flex-1`}
                  style={{ colorScheme: "dark" }}
                >
                  {TIME_UNITS.map((u) => (
                    <option key={u} value={u} className="bg-bg">
                      {u}
                    </option>
                  ))}
                </select>
                <span className="shrink-0 font-mono text-sm tabular text-dim">
                  {formatTimeStep(timeUnit)}
                </span>
              </div>
            </Field>

            {/* Playback quality */}
            <Field label="Playback quality" help={PLAYBACK_QUALITY_COPY}>
              <PlaybackQualityPicker
                bucket={fidelityBucket}
                onChange={setFidelityBucket}
              />
            </Field>

            {/* Bodies catalog */}
            <div className="mb-2">
              <div className="eyebrow mb-2">Bodies</div>
            </div>
            <div className="mb-6 flex min-h-0 flex-col">
              <BodyCatalogPane
                selected={selectedBodies}
                onToggleBody={toggleBody}
                onSetMany={setMany}
                onSetSelection={setSelection}
              />
            </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 border-t border-white/[0.06] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] tabular text-dim">
                {integrator.toUpperCase()} · {frame.split(" ")[0]} ·{" "}
                <span className="text-accent">{selectedBodies.size} bodies</span>
              </span>
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={selectedBodies.size === 0 || busy}
                className="flex h-11 shrink-0 items-center gap-2 rounded-chip px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background:
                    selectedBodies.size === 0
                      ? "rgba(255,255,255,0.06)"
                      : "linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)",
                  color:
                    selectedBodies.size === 0
                      ? "var(--color-subdim)"
                      : "#16182a",
                  boxShadow:
                    selectedBodies.size === 0
                      ? "none"
                      : "0 0 0 3px rgba(164,168,255,0.18), 0 4px 14px rgba(146,152,238,0.45)",
                }}
              >
                {busy ? (
                  <>
                    <span
                      className="inline-block h-[13px] w-[13px] animate-spin rounded-full border-2 border-current/30 border-t-current"
                      aria-hidden
                    />
                    {submitMsg}
                  </>
                ) : (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 13 13"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M3 2l8 4.5L3 11V2z" />
                    </svg>
                    Run simulation
                  </>
                )}
              </button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
