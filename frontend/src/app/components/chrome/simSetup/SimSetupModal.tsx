"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDispatch } from "react-redux";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setIsPaused, setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import { BODY_DISPLAY, type BodyKey } from "@/app/constants/BodyVisuals";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";
import {
  DEFAULT_FRAME,
  FRAME_CODE,
  type TimeUnit,
} from "@/app/constants/SimParams";
import {
  INTEGRATOR_DEFAULT_BUCKETS,
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";
import { SimParamsPane } from "@/app/components/chrome/simSetup/SimParamsPane";
import { BodyCatalogPane } from "@/app/components/chrome/simSetup/BodyCatalogPane";
import { matchPresetClip } from "@/app/utils/presetClipMatch";
import { runStaticClip } from "@/app/utils/runStaticClip";
import {
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "@/app/utils/runSimulation";

// Centered two-pane Sim Setup modal: simulation params (left) + body catalog
// (right). Replaces the left-anchored SimSetupDrawer. Radix Dialog substrate is
// kept (focus trap, Esc, scroll-lock, portal a11y); the scene scrim stays
// visible behind so you can see what you're configuring against. Params are a
// draft committed on Run, so close/Esc/scrim-click discards.

interface SimSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimSetupModal({ open, onOpenChange }: SimSetupModalProps) {
  const dispatch = useDispatch<AppDispatch>();

  const [selectedBodies, setSelectedBodies] = useState<Set<BodyKey>>(
    new Set(DEFAULT_SELECTED),
  );
  // Defaults derive from the shared preset constants so an untouched Run
  // stays an exact match for the precomputed default clip; a literal here
  // would silently break the interception if the constants ever moved.
  const [epoch, setEpoch] = useState(PRESET_EPOCH);
  const [frame, setFrame] = useState<string>(DEFAULT_FRAME);
  const [integrator, setIntegrator] = useState<string>(PRESET_INTEGRATOR);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(PRESET_TIME_UNIT);
  const [fidelityBucket, setFidelityBucket] = useState<FidelityBucket>(
    INTEGRATOR_DEFAULT_BUCKETS[integrator] ?? "medLow",
  );
  // Non-null while a Run is in flight; holds the button's progress label
  // ("Starting…", then "Waking up…" if the backend is cold-starting).
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  // Reset the bucket to the new integrator's landing default when integrator
  // changes. Guarded set-state-in-render (not useEffect) to satisfy the repo's
  // set-state-in-effect lint rule and produce one render with the new default.
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

  const enabled = selectedBodies.size;
  const busy = submitMsg !== null;

  const handleSubmit = async () => {
    const celestialBodyNames = Array.from(selectedBodies).map(
      (k) => BODY_DISPLAY[k],
    );
    if (celestialBodyNames.length === 0) return; // Run is disabled at 0 anyway
    if (busy) return; // a Run is already in flight

    // A draft that exactly reproduces a canonical preset scenario plays the
    // precomputed clip from the edge: no session, no backend wake, instant
    // start. Falls through to the live path if the asset is unreachable.
    const clipId = matchPresetClip({
      bodyKeys: selectedBodies,
      epoch,
      frame,
      integrator,
      timeStepUnit: timeUnit,
      fidelityBucket,
    });
    if (clipId !== null) {
      setSubmitMsg("Starting simulation…");
      let played = false;
      try {
        played = await runStaticClip(dispatch, clipId);
      } catch {
        // runStaticClip reports failure by returning false; this backstop
        // keeps a future regression from stranding the disabled Run button.
      }
      if (played) {
        setSubmitMsg(null);
        onOpenChange(false);
        return;
      }
      // Fall through to the live path WITHOUT clearing the message: the live
      // branch re-sets the same text, and clearing first would flash the
      // button back to enabled for one render.
    }

    // Capture the session this run replaces BEFORE initialize wipes it, so the
    // backend releases it immediately rather than orphaning it for the full
    // idle timeout. Undefined (first run) is omitted from the body, a no-op.
    const previousSessionID =
      store.getState().simulation.simulationParameters?.simulationMetaData
        ?.sessionID;

    const requestPayload = {
      celestialBodyNames,
      date: epoch,
      frame,
      integrator,
      timeStepUnit: timeUnit,
      fidelityBucket,
    };
    setSubmitMsg("Starting simulation…");
    try {
      // initializeCelestialBodies retries a cold-starting backend internally
      // and surfaces its own error toast; it returns false rather than throwing.
      // Backend wants the frame CODE; lastRequest keeps the LABEL for display.
      const ok = await initializeCelestialBodies(
        dispatch,
        { ...requestPayload, frame: FRAME_CODE[frame] ?? frame, previousSessionID },
        {
          onRetry: () =>
            setSubmitMsg("Waking up the simulator, this can take a few seconds…"),
        },
      );
      if (!ok) return; // error already shown; keep the modal open so they can retry

      const sessionID =
        store.getState().simulation.simulationParameters?.simulationMetaData
          ?.sessionID;
      if (!sessionID) return; // defensive: ok was true, so this should not happen
      dispatch(setLastSimRequest(requestPayload));
      dispatchChunkRequest(dispatch, { sessionID });
      // Auto-start: the controller gates on isPaused AND a populated buffer,
      // so unpausing now springs the scene into motion the instant the first
      // chunk arrives.
      dispatch(setIsPaused(false));
      onOpenChange(false);
    } finally {
      setSubmitMsg(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 transition-opacity duration-200 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100"
          style={{
            background: "rgba(5,6,12,0.45)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
          }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden transition-[transform,opacity] duration-200 ease-out data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=open]:opacity-100"
          style={{
            width: 1180,
            height: 800,
            maxWidth: "calc(100vw - 48px)",
            maxHeight: "calc(100vh - 48px)",
            background: "rgba(20,22,30,0.62)",
            backdropFilter: "blur(22px) saturate(150%)",
            WebkitBackdropFilter: "blur(22px) saturate(150%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 18,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.06), 0 40px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(164,168,255,0.12)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between border-b border-white/[0.06]"
            style={{
              padding: "20px 28px 18px",
              background:
                "linear-gradient(180deg, rgba(164,168,255,0.07) 0%, transparent 100%)",
            }}
          >
            <div>
              <p className="eyebrow text-accent" style={{ letterSpacing: "0.22em" }}>
                Simulation parameters
              </p>
              <Dialog.Title className="text-hi mt-[5px] text-[21px] font-semibold tracking-[-0.02em]">
                Configure simulation
              </Dialog.Title>
              <Dialog.Description className="text-dim mt-[5px] max-w-[560px] text-[12.5px] leading-[1.45]">
                Changes apply on Run. Epoch, frame and integrator define how the
                system evolves; the body catalog sets what is tracked.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-dim hover:text-hi grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03]"
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
            </Dialog.Close>
          </div>

          {/* Body — two panes */}
          <div className="flex min-h-0 flex-1">
            <SimParamsPane
              epoch={epoch}
              onEpoch={setEpoch}
              frame={frame}
              onFrame={setFrame}
              integrator={integrator}
              onIntegrator={setIntegrator}
              timeUnit={timeUnit}
              onTimeUnit={setTimeUnit}
              fidelityBucket={fidelityBucket}
              onFidelity={setFidelityBucket}
            />
            <BodyCatalogPane
              selected={selectedBodies}
              onToggleBody={toggleBody}
              onSetMany={setMany}
              onSetSelection={setSelection}
            />
          </div>

          {/* Footer */}
          <div
            className="flex items-center gap-4 border-t border-white/[0.06]"
            style={{ padding: "16px 28px", background: "rgba(255,255,255,0.02)" }}
          >
            <button
              type="button"
              onClick={() => setSelection(DEFAULT_SELECTED)}
              className="text-dim text-[12.5px]"
              style={{ letterSpacing: "-0.005em" }}
            >
              Reset to defaults
            </button>
            <div className="flex-1" />
            <div className="text-dim tabular font-mono text-[11.5px]">
              {integrator.toUpperCase()} · {frame.split(" ")[0]} ·{" "}
              <span className="text-accent">{enabled} bodies</span>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={enabled === 0 || busy}
              className="flex items-center gap-2.5 text-[14px] font-semibold disabled:cursor-not-allowed"
              style={{
                padding: "12px 28px",
                borderRadius: 11,
                border: "1px solid rgba(196,200,255,0.85)",
                letterSpacing: "-0.005em",
                background:
                  enabled === 0
                    ? "rgba(255,255,255,0.06)"
                    : "linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)",
                color: enabled === 0 ? "var(--color-subdim)" : "#16182a",
                opacity: enabled === 0 ? 0.6 : 1,
                boxShadow:
                  enabled === 0
                    ? "none"
                    : "0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.5), inset 0 1px 0 rgba(255,255,255,0.55)",
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
                    width="13"
                    height="13"
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
