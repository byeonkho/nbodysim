import type { ReactNode } from "react";

// Shared visual treatment for the view-toggle rows: the desktop Timeline and
// the mobile control sheet render the same borderless icon + label + indicator
// column so the two surfaces stay in lockstep. The buttons themselves remain
// platform-specific (the desktop chip carries tooltip-portal mechanics the
// mobile sheet doesn't need), so this module exports the pieces, not a button.

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// Simple line glyphs, one per view control. Hand-drawn to match the repo's
// other inline icons (transport buttons, build FAB); no icon library is used.
export const VIEW_TOGGLE_ICONS = {
  // Ring + body on the ring.
  orbits: (
    <Glyph>
      <ellipse cx="12" cy="12" rx="10" ry="5" />
      <circle cx="20" cy="11" r="1.6" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  // Name tag.
  labels: (
    <Glyph>
      <path d="M4 4h9l7 7-9 9-7-7V4z" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  // Comet: dotted path fading behind a body.
  trails: (
    <Glyph>
      <path d="M3 17c6 0 9-3 12-7" strokeDasharray="1.5 3" strokeLinecap="round" />
      <circle cx="18" cy="8" r="2.6" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  // Simulated body vs dashed real-world position, linked.
  drift: (
    <Glyph>
      <circle cx="8" cy="12" r="3" />
      <circle cx="17" cy="12" r="2" strokeDasharray="1.4 2.2" />
      <path d="M11 12h3" strokeLinecap="round" />
    </Glyph>
  ),
  // Resize brackets.
  scale: (
    <Glyph>
      <path
        d="M9 3H5v4M15 3h4v4M9 21H5v-4M15 21h4v-4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  ),
  // Aperture.
  camera: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  ),
  // Crosshair.
  axes: (
    <Glyph>
      <path d="M12 4v16M4 12h16" strokeLinecap="round" />
    </Glyph>
  ),
  // Four squares.
  grid: (
    <Glyph>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </Glyph>
  ),
};

// Borderless column button: icon on top, label, then a fixed-height indicator
// slot. flex-1 inside the row so every item gets an equal share; min-h keeps
// the touch target at the 44px floor.
export const TOGGLE_BUTTON_CLASS =
  "flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center gap-1.5 pt-1.5 pb-1 transition-colors";

// Booleans glow accent when on and sit dim when off; mode toggles (Scale,
// Camera) cycle named values with no "off", so they stay neutral and never
// take the accent "on" look.
export function toggleTone(hasValue: boolean, on: boolean) {
  if (hasValue) return "text-text hover:text-hi";
  return on ? "text-accent" : "text-dim hover:text-text";
}

export function ToggleContent({
  icon,
  label,
  on = false,
  value,
  busy = false,
}: {
  icon: ReactNode;
  label: string;
  on?: boolean;
  value?: string;
  /** Pulses the icon while the control's data is still loading. */
  busy?: boolean;
}) {
  const hasValue = value !== undefined;
  return (
    <>
      <span className={busy ? "animate-pulse" : undefined}>{icon}</span>
      <span className="text-[11px] leading-none">{label}</span>
      {/* Fixed-height slot so labels stay aligned whether the item shows a
          state dot or a value caption. */}
      <span className="grid h-[11px] place-items-center">
        {hasValue ? (
          <span className="tabular text-accent font-mono text-[8px] leading-none tracking-[0.08em] uppercase">
            {value}
          </span>
        ) : (
          <span
            className="h-1 w-1 rounded-full"
            style={
              on
                ? {
                    background: "var(--color-accent)",
                    boxShadow: "0 0 6px var(--color-accent)",
                  }
                : undefined
            }
          />
        )}
      </span>
    </>
  );
}
