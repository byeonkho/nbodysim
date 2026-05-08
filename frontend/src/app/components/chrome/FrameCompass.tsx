"use client";

// Frame compass widget — shows the current display frame and a small
// schematic of the orbital plane. Click handler stubbed; Phase 4 (#42)
// wires a popover that cycles helio / bary / geo and applies the
// client-side frame transform.

export function FrameCompass({ frame = "Heliocentric" }: { frame?: string }) {
  return (
    <div
      className="glass pointer-events-auto absolute top-[96px] left-6 w-24 px-3 py-2.5 text-center"
      style={{ borderRadius: 10 }}
    >
      <div className="eyebrow mb-1.5">FRAME</div>
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        className="mx-auto block"
      >
        <circle
          cx="32"
          cy="32"
          r="28"
          fill="none"
          stroke="rgba(255,255,255,0.10)"
        />
        <circle
          cx="32"
          cy="32"
          r="20"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
        />
        <line
          x1="32"
          y1="6"
          x2="32"
          y2="58"
          stroke="rgba(255,255,255,0.10)"
        />
        <line
          x1="6"
          y1="32"
          x2="58"
          y2="32"
          stroke="rgba(255,255,255,0.10)"
        />
        <text
          x="32"
          y="13"
          fontSize="8"
          fill="var(--color-dim)"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          +Y
        </text>
        <text
          x="58"
          y="35"
          fontSize="8"
          fill="var(--color-dim)"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          +X
        </text>
        <circle cx="32" cy="32" r="4" fill="var(--color-amber)" />
        <text
          x="32"
          y="50"
          fontSize="8"
          fill="var(--color-amber)"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
        >
          ☉
        </text>
      </svg>
      <div className="text-hi mt-1 text-[10px] font-medium">{frame}</div>
    </div>
  );
}
