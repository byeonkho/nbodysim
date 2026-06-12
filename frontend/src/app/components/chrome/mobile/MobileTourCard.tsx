"use client";

import { forwardRef } from "react";

export interface MobileTourCardProps {
  eyebrow: string;
  copy: string;
  /** 1-based current position and total, for the progress dots. */
  current: number;
  total: number;
  canBack: boolean;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const accent = "var(--color-accent)";

// The mobile tour's glass card: eyebrow, copy, progress dots, and Skip / Back /
// Next (Done on the last step). Placement is handled by the overlay; this is
// just the box.
export const MobileTourCard = forwardRef<HTMLDivElement, MobileTourCardProps>(
  function MobileTourCard(
    { eyebrow, copy, current, total, canBack, isLast, onNext, onBack, onSkip },
    ref,
  ) {
    return (
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label="Intro tour"
        tabIndex={-1}
        className="glass w-[min(360px,88vw)] p-4"
        style={{ pointerEvents: "auto" }}
      >
        <div className="eyebrow mb-1.5">{eyebrow}</div>
        <p className="text-hi text-sm leading-[1.55]">{copy}</p>

        <div className="mt-4 flex items-center justify-between">
          <span className="flex gap-1.5" aria-hidden="true">
            {Array.from({ length: total }).map((_, i) => (
              <i
                key={i}
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    i === current - 1 ? accent : "rgba(255,255,255,0.22)",
                }}
              />
            ))}
          </span>

          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSkip}
              className="text-dim hover:text-hi px-1 text-xs transition-colors"
            >
              Skip
            </button>
            {canBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-hi rounded-md border border-white/15 px-3 py-2 text-xs transition-colors hover:bg-white/[0.06]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="rounded-md px-3.5 py-2 text-xs font-medium text-white"
              style={{ background: accent }}
            >
              {isLast ? "Done" : "Next"}
            </button>
          </span>
        </div>
      </div>
    );
  },
);
