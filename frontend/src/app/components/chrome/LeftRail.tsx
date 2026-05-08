"use client";

// Left rail — six icon buttons. All click handlers stubbed in Phase 1;
// real wiring lands across later phases:
//   - layers icon: Phase 1B (#38) stylized-vs-realistic toggle popover
//   - drift icon: Phase 7 (#39) reality-drift overlay toggle
//   - top-down camera icon: Phase 2 (#58) camera-preset switch
//   - settings icon: opens Sim Params (Phase 1, sub-commit 4)

interface RailIcon {
  d: string;
  label: string;
}

const ICONS: RailIcon[] = [
  {
    d: "M11 3v2M11 17v2M3 11h2M17 11h2M5 5l1.4 1.4M15.6 15.6L17 17M5 17l1.4-1.4M15.6 6.4L17 5",
    label: "Scope",
  },
  {
    d: "M11 3a8 8 0 100 16 8 8 0 000-16zm-3 8a3 3 0 116 0 3 3 0 01-6 0z",
    label: "Target",
  },
  {
    d: "M11 3l8 4-8 4-8-4 8-4zM3 11l8 4 8-4M3 15l8 4 8-4",
    label: "Layers",
  },
  {
    d: "M5 7h3l1-2h4l1 2h3v9H5V7zm6 2a3 3 0 100 6 3 3 0 000-6z",
    label: "Camera",
  },
  {
    d: "M11 8a3 3 0 110 6 3 3 0 010-6zM11 3v2M11 17v2M3 11h2M17 11h2",
    label: "Settings",
  },
];

export function LeftRail({ activeIndex }: { activeIndex?: number }) {
  return (
    <div
      className="glass pointer-events-auto absolute top-1/2 left-6 flex -translate-y-1/2 flex-col gap-1 p-2"
      style={{ borderRadius: 14 }}
    >
      {ICONS.map((icon, i) => (
        <RailButton
          key={icon.label}
          label={icon.label}
          path={icon.d}
          active={i === activeIndex}
        />
      ))}
      <div className="mx-1 my-1 h-px bg-white/[0.06]" />
      <RailButton
        label="Frame info"
        path="M10 7a3 3 0 110 6 3 3 0 010-6z M10 1v3M10 16v3M1 10h3M16 10h3"
        viewBox="0 0 20 20"
      />
    </div>
  );
}

function RailButton({
  label,
  path,
  active,
  viewBox = "0 0 22 22",
}: {
  label: string;
  path: string;
  active?: boolean;
  viewBox?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        "grid h-[38px] w-[38px] cursor-pointer place-items-center rounded-[10px] transition-colors",
        active
          ? "bg-[rgba(164,168,255,0.18)] text-accent"
          : "text-[#b1b4be] hover:bg-white/[0.04] hover:text-hi",
      ].join(" ")}
    >
      <svg
        width="22"
        height="22"
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </button>
  );
}
