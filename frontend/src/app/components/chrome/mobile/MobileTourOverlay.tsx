"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import { selectHasReceivedFirstChunk } from "@/app/store/slices/SimulationSlice";
import { useTourTarget } from "@/app/components/interface/tour/useTourTarget";
import {
  MOBILE_TOUR_STEPS,
  MOBILE_TOUR_SEEN_KEY,
} from "@/app/constants/mobileTourSteps";
import { MobileTourCard } from "./MobileTourCard";

// Scene dim for welcome/done and for the build spotlight. Kept light so the
// live scene stays the hero. Tunable.
const SCRIM = "rgba(5, 6, 16, 0.45)";
// The giant box-shadow spread IS the dim, plus a two-layer accent glow ring.
// Same recipe as the desktop TourOverlay, kept inline so the desktop tour stays
// untouched.
const SPOTLIGHT_SHADOW =
  `0 0 0 9999px ${SCRIM}, 0 0 16px 2px var(--color-accent), ` +
  `0 0 0 1px color-mix(in srgb, var(--color-accent) 70%, transparent)`;

function readSeen(): boolean {
  if (typeof window === "undefined") return true; // SSR: never show server-side
  return window.localStorage.getItem(MOBILE_TOUR_SEEN_KEY) === "1";
}

export function MobileTourOverlay({ buildSheetOpen }: { buildSheetOpen: boolean }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Lazy initializer runs once synchronously -- no setState in an effect,
  // no ref read during render. A returning visitor starts as already seen.
  const [seen] = useState<boolean>(readSeen);

  const hasFirstChunk = useSelector(selectHasReceivedFirstChunk);

  // Derived, not an effect: true when the scene goes live (first chunk buffered)
  // on a first visit, false once finished or skipped.
  const active = !seen && hasFirstChunk && !finished;

  const step = active ? MOBILE_TOUR_STEPS[stepIndex] : null;

  // Resolve the build button's rect only on its step (null otherwise).
  const rect = useTourTarget(step?.target ?? null);

  // Move focus into the card when a step appears (a11y). No setState here, so
  // the set-state-in-effect rule does not apply.
  useEffect(() => {
    if (active) cardRef.current?.focus?.();
  }, [active, stepIndex]);

  // Opening the builder from the spotlighted build step finishes the tour for
  // good (it must not reappear when the sheet is closed or a run completes).
  // Adjusting state during render on a prop change is the supported pattern and
  // avoids the set-state-in-effect rule.
  const [prevSheetOpen, setPrevSheetOpen] = useState(buildSheetOpen);
  if (buildSheetOpen !== prevSheetOpen) {
    setPrevSheetOpen(buildSheetOpen);
    if (buildSheetOpen && step?.id === "build") {
      setFinished(true);
    }
  }

  // Persist the finished flag so the tour does not reappear on reload. This is
  // a localStorage write (not setState), so it does not trip the
  // set-state-in-effect rule, and it covers every finish path (Next on the last
  // step, Skip, and the build-FAB latch above).
  useEffect(() => {
    if (finished) window.localStorage.setItem(MOBILE_TOUR_SEEN_KEY, "1");
  }, [finished]);

  if (!active || !step || typeof document === "undefined") return null;

  const isLast = stepIndex === MOBILE_TOUR_STEPS.length - 1;

  // Persistence is handled by the finished-keyed effect above, so every finish
  // path (this, Skip, the build-FAB latch) only needs to flip the flag.
  const finish = () => setFinished(true);
  const next = () => {
    if (isLast) finish();
    else setStepIndex((i) => i + 1);
  };
  const back = () => setStepIndex((i) => Math.max(0, i - 1));

  // Spotlight box for the build step (once its target rect resolves).
  const PAD = 8;
  const spotlight =
    step.target && rect
      ? {
          left: rect.left - PAD,
          top: rect.top - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
        }
      : null;

  // Card placement. A targeted step docks the card next to its spotlight,
  // aligned to the spotlight's left and clamped into the viewport: below a
  // target in the top half of the screen (the rail), above one in the bottom
  // half (the build FAB), so the card never runs off an edge. Otherwise the
  // card is centered, or docked above the collapsed control sheet peek.
  const CARD_MARGIN = 12;
  let cardWrap: CSSProperties;
  if (spotlight) {
    const cardW = Math.min(360, window.innerWidth * 0.88);
    const left = Math.max(
      CARD_MARGIN,
      Math.min(spotlight.left, window.innerWidth - cardW - CARD_MARGIN),
    );
    // Dock below a target in the top half (the rail), above one in the bottom
    // half (the build FAB), so the card never runs off the screen edge.
    const targetMid = spotlight.top + spotlight.height / 2;
    cardWrap =
      targetMid < window.innerHeight / 2
        ? { left, top: spotlight.top + spotlight.height + CARD_MARGIN }
        : { left, bottom: window.innerHeight - spotlight.top + CARD_MARGIN };
  } else if (step.placement === "bottom") {
    cardWrap = {
      left: "50%",
      bottom: "calc(env(safe-area-inset-bottom, 0px) + 112px)",
      transform: "translateX(-50%)",
    };
  } else {
    cardWrap = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }

  // The spotlight provides its own dim; otherwise a light scrim, or a fully
  // transparent (but pointer-capturing) layer for the gesture steps.
  const backdrop = spotlight
    ? "transparent"
    : step.dim === "light"
      ? SCRIM
      : "transparent";

  return createPortal(
    // The z-[60] wrapper is full-screen, so it must be pointer-transparent or
    // it swallows taps meant for a spotlit element (the build FAB) even when the
    // capturer below is pointer-none. Blocking is delegated to the capturer; the
    // card opts its buttons back into pointer events.
    <div className="fixed inset-0 z-[60]" style={{ pointerEvents: "none" }}>
      {/* Full-screen capturer: makes the tour modal (blocks scene taps). The
          scene keeps animating behind it, which is the "celebrate" beat.
          On spotlighted steps the capturer is pointer-none so taps pass
          through to the spotlit element (e.g. the build FAB). */}
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ background: backdrop, pointerEvents: spotlight ? "none" : "auto" }}
      />
      {/* Build-step spotlight: dims everything but the button and rings it. */}
      {spotlight && (
        <div
          aria-hidden="true"
          className="fixed"
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
            borderRadius: step.spotlightRadius ?? 9999,
            boxShadow: SPOTLIGHT_SHADOW,
            pointerEvents: "none",
          }}
        />
      )}

      <div className="fixed" style={{ ...cardWrap, pointerEvents: "auto" }}>
        <MobileTourCard
          ref={cardRef}
          eyebrow={step.eyebrow}
          copy={step.copy}
          current={stepIndex + 1}
          total={MOBILE_TOUR_STEPS.length}
          canBack={stepIndex > 0}
          isLast={isLast}
          onNext={next}
          onBack={back}
          onSkip={finish}
        />
      </div>
    </div>,
    document.body,
  );
}
