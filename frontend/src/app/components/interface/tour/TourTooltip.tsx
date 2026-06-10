"use client";

import { forwardRef } from "react";

export type TooltipVariant = "welcome" | "sim-setup" | "step" | "done";

export interface TourTooltipProps {
  eyebrow: string;
  copy: string;
  /** 1-based current position and total, for the progress dots. */
  current: number;
  total: number;
  variant: TooltipVariant;
  canBack: boolean;
  onPrimary: () => void;
  onSecondary: () => void; // welcome only: "I'll explore solo"
  onBack: () => void;
  onSkip: () => void;
}

const accent = "var(--color-accent)";

export const TourTooltip = forwardRef<HTMLDivElement, TourTooltipProps>(
  function TourTooltip(
    {
      eyebrow,
      copy,
      current,
      total,
      variant,
      canBack,
      onPrimary,
      onSecondary,
      onBack,
      onSkip,
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label="Intro tour"
        tabIndex={-1}
        className="glass w-[340px] max-w-[88vw] p-4"
        style={{ pointerEvents: "auto" }}
      >
        <div className="eyebrow mb-1.5">{eyebrow}</div>
        <p className="text-hi text-[13px] leading-[1.55]">{copy}</p>

        <div className="mt-3.5 flex items-center justify-between">
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
            {variant === "welcome" ? (
              <>
                <button
                  type="button"
                  onClick={onSecondary}
                  className="text-dim hover:text-hi text-[12px] transition-colors"
                >
                  I&apos;ll explore solo
                </button>
                <button
                  type="button"
                  onClick={onPrimary}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
                  style={{ background: accent }}
                >
                  Take the tour
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onSkip}
                  className="text-dim hover:text-hi text-[12px] transition-colors"
                >
                  Skip
                </button>
                {canBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    className="text-hi rounded-md border border-white/15 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-white/[0.06]"
                  >
                    Back
                  </button>
                )}
                {variant !== "sim-setup" && (
                  <button
                    type="button"
                    onClick={onPrimary}
                    className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white"
                    style={{ background: accent }}
                  >
                    {variant === "done" ? "Done" : "Next"}
                  </button>
                )}
              </>
            )}
          </span>
        </div>
      </div>
    );
  },
);
