"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useSelector, useStore } from "react-redux";
import type { RootState } from "@/app/store/Store";
import {
  selectTourStatus,
  selectTourStepIndex,
  nextStep,
  prevStep,
  skipTour,
  finishTour,
} from "@/app/store/slices/TourSlice";
import {
  PHASE1_STEPS,
  PHASE2_STEPS,
  type TourStep,
} from "@/app/constants/tourSteps";
import {
  setActiveBody,
  selectIsBodyActive,
  selectCelestialBodyPropertiesList,
} from "@/app/store/slices/SimulationSlice";
import { useTourTarget } from "@/app/components/interface/tour/useTourTarget";
import {
  TourTooltip,
  type TooltipVariant,
} from "@/app/components/interface/tour/TourTooltip";

const noopSubscribe = () => () => {};

// ~42% scene dim (matches the approved "soft dim + glowing edge" look) plus a
// two-layer accent glow ring. The box-shadow's giant spread IS the dim, so a
// pointer-events:none box over the target leaves the target itself clickable.
const DIM = "rgba(5, 6, 16, 0.42)";
const SPOTLIGHT_SHADOW =
  `0 0 0 9999px ${DIM}, 0 0 16px 2px var(--color-accent), ` +
  `0 0 0 1px color-mix(in srgb, var(--color-accent) 70%, transparent)`;

export function TourOverlay({ simSetupOpen }: { simSetupOpen: boolean }) {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const status = useSelector(selectTourStatus);
  const stepIndex = useSelector(selectTourStepIndex);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Resolve the active step (null when the tour isn't visibly running).
  const steps: readonly TourStep[] | null =
    status === "phase1"
      ? PHASE1_STEPS
      : status === "phase2"
        ? PHASE2_STEPS
        : null;
  const step = steps ? (steps[stepIndex] ?? null) : null;

  // Hidden while: idle/done/awaitingRun (steps === null), or whenever the Sim
  // Setup modal is open, in either phase, so we never double-dim under the
  // dialog or float the spotlight over it.
  const hidden = !step || simSetupOpen;

  const target = hidden ? null : step!.target;
  const rect = useTourTarget(target);

  // Info-card safeguard: stepping onto the info-card step with nothing
  // selected, auto-select a body (Earth if present, else the first) so the
  // card mounts and there is something to point at.
  useEffect(() => {
    if (hidden || step?.id !== "info-card") return;
    const s = store.getState();
    if (selectIsBodyActive(s)) return;
    const list = selectCelestialBodyPropertiesList(s) ?? [];
    const name = list.find((b) => b.name === "Earth")?.name ?? list[0]?.name;
    if (name) dispatch(setActiveBody(name));
  }, [hidden, step?.id, store, dispatch]);

  // Keyboard: Esc skips, ArrowLeft = back, ArrowRight/Enter = primary advance.
  // Reads fresh store state inside the handler (no closure over post-return
  // derived consts), so deps are just [hidden]. The sim-setup step has no
  // keyboard advance (you advance by running a sim).
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dispatch(skipTour());
      } else if (e.key === "ArrowLeft") {
        dispatch(prevStep());
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        const t = store.getState().tour;
        if (t.status === "phase2" && t.stepIndex === PHASE2_STEPS.length - 1) {
          dispatch(finishTour());
        } else if (!(t.status === "phase1" && t.stepIndex === 1)) {
          dispatch(nextStep()); // phase1 sim-setup (index 1) has no advance
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, dispatch, store]);

  // Remember what had focus when the tour opened, and restore it when the tour
  // closes. Deps are just [hidden], so this captures once on open and runs its
  // cleanup once on close (not on every step change). Declared before the
  // focus-into-tooltip effect so it captures the pre-tour element, not the
  // tooltip.
  useEffect(() => {
    if (hidden) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => previouslyFocused?.focus?.();
  }, [hidden]);

  // Move focus into the tooltip when a step appears.
  useEffect(() => {
    if (!hidden) tooltipRef.current?.focus?.();
  }, [hidden, status, stepIndex]);

  if (hidden || !mounted) return null;

  const isPhase2 = status === "phase2";
  const isLast = isPhase2 && stepIndex === PHASE2_STEPS.length - 1;
  const total = isPhase2 ? PHASE2_STEPS.length : PHASE1_STEPS.length;

  const variant: TooltipVariant =
    step!.id === "welcome"
      ? "welcome"
      : step!.id === "sim-setup"
        ? "sim-setup"
        : step!.id === "done"
          ? "done"
          : "step";

  const advancePrimary = () => {
    if (isLast) dispatch(finishTour());
    else if (step!.id !== "sim-setup") dispatch(nextStep());
    // sim-setup: no primary advance; user runs a sim to continue.
  };

  // --- Geometry ---
  const PAD = 8;
  const spotlightBox =
    step!.target && rect
      ? {
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }
      : null;

  // Tooltip placement: centered for welcome/done, else anchored to the rect.
  const TT_W = 340;
  const GAP = 12;
  let ttStyle: React.CSSProperties;
  if (!step!.target || !rect) {
    ttStyle = {
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  } else {
    const rawLeft = rect.left + rect.width / 2 - TT_W / 2;
    const left = Math.max(8, Math.min(rawLeft, window.innerWidth - TT_W - 8));
    if (step!.placement === "above") {
      ttStyle = { left, top: rect.top - GAP, transform: "translateY(-100%)" };
    } else {
      ttStyle = { left, top: rect.bottom + GAP };
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]" style={{ pointerEvents: "none" }}>
      {/* Dim: a full-screen capturer for centered steps (no target to click
          through); a box-shadow-spread spotlight when a target exists. */}
      {spotlightBox ? (
        <div
          aria-hidden="true"
          className="fixed rounded-lg"
          style={{
            left: spotlightBox.left,
            top: spotlightBox.top,
            width: spotlightBox.width,
            height: spotlightBox.height,
            boxShadow: SPOTLIGHT_SHADOW,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="fixed inset-0"
          style={{ background: DIM, pointerEvents: "auto" }}
        />
      )}

      <div className="fixed" style={{ ...ttStyle, pointerEvents: "auto" }}>
        <TourTooltip
          ref={tooltipRef}
          eyebrow={step!.eyebrow}
          copy={step!.copy}
          current={stepIndex + 1}
          total={total}
          variant={variant}
          canBack={stepIndex > 0}
          onPrimary={advancePrimary}
          onSecondary={() => dispatch(skipTour())}
          onBack={() => dispatch(prevStep())}
          onSkip={() => dispatch(skipTour())}
        />
      </div>
    </div>,
    document.body,
  );
}
