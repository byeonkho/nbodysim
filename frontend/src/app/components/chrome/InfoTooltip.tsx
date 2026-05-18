"use client";

/**
 * Small info-icon button with a hover/focus tooltip. CSS-only visibility
 * via Tailwind group-hover / group-focus-within — no JS state, no portal.
 * Desktop-focused; mobile touch UX is a Phase 8 (#35) concern. Tooltip
 * appears above-right of the icon; if the field is near the right edge of
 * the drawer the tooltip may clip — acceptable for the SimSetupDrawer's
 * fixed-width left-rail layout.
 */
export function InfoTooltip({
  label,
  children,
}: {
  /** Screen-reader label for the icon button. */
  label: string;
  /** Tooltip body (text or rich content). */
  children: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
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
      <span
        role="tooltip"
        className="text-hi pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-white/[0.08] px-3 py-2 text-[11px] leading-[1.5] opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        style={{ background: "rgba(10, 12, 20, 0.96)" }}
      >
        {children}
      </span>
    </span>
  );
}
