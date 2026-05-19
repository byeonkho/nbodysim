"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// Stable subscribe for useSyncExternalStore — never re-fires. The hook's
// only job here is to defer "we have document.body" to client render;
// no real subscription is needed.
const noopSubscribe = () => () => {};

/**
 * Small info-icon button with a hover/focus tooltip. The tooltip body
 * renders via a React Portal into `document.body` so it escapes every
 * ancestor's stacking context, overflow:hidden, and backdrop-filter —
 * the three classes of "tooltip is invisible / clipped / behind the
 * canvas" bug we'd otherwise hit. Position is computed from the
 * icon button's bounding rect once the tooltip becomes visible.
 *
 * Hover/focus state is JS-tracked (one boolean per instance). Visibility
 * is opacity-only so the transition still animates; pointer-events stay
 * off the tooltip itself so it never blocks clicks on whatever sits
 * underneath.
 *
 * `placement="above"` (default) opens upward; "below" opens downward.
 */
export function InfoTooltip({
  label,
  children,
  placement = "above",
}: {
  /** Screen-reader label for the icon button. */
  label: string;
  /** Tooltip body (text or rich content). */
  children: React.ReactNode;
  /** Open direction. Default "above". */
  placement?: "above" | "below";
}) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );

  // Portal target = document.body. Only available client-side;
  // useSyncExternalStore returns false on SSR and true post-hydration,
  // gating createPortal without a state-write-in-effect (the canonical
  // anti-pattern flagged by react-hooks/set-state-in-effect).
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  // Recompute the tooltip's position whenever it opens. Anchored to the
  // icon button's bounding rect; horizontally centered on the icon,
  // vertically above or below depending on placement. Re-measures on
  // each open rather than tracking scroll/resize live — the tooltip
  // only lives for the duration of a hover/focus, so a stale position
  // would only show if the user scrolls *during* the hover.
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const tooltipWidth = 256; // matches w-64
    const gap = 8;
    setCoords({
      left: rect.left + rect.width / 2 - tooltipWidth / 2,
      top:
        placement === "below"
          ? rect.bottom + gap
          : rect.top - gap, // tooltip's BOTTOM sits here; CSS uses translateY(-100%) to flip
    });
  }, [open, placement]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-dim hover:text-hi focus-visible:text-hi flex h-4 w-4 items-center justify-center rounded-full outline-none transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM7 6.5a1 1 0 112 0v4.5a1 1 0 11-2 0V6.5zM8 3.75a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      </button>
      {mounted &&
        coords &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="text-hi pointer-events-none fixed z-50 w-64 rounded-md border border-white/[0.08] px-3 py-2 text-[11px] leading-[1.5] shadow-lg transition-opacity duration-150"
            style={{
              background: "rgba(10, 12, 20, 0.96)",
              left: coords.left,
              top: coords.top,
              opacity: open ? 1 : 0,
              transform: placement === "above" ? "translateY(-100%)" : "none",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
