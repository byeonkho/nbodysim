"use client";

// Primary CTA in the top bar — opens the SimSetup drawer. Two visual
// states (filled vs outlined) match the handoff: filled when closed,
// outlined "active" when the drawer is open. Pulse dot at top-right
// hints "do this first" until the user has run their first sim
// (derived from SimulationSlice.lastRequest — once it exists, the
// pulse is suppressed). See spacesim-ui/design_handoff_sim_setup/.

interface SimSetupButtonProps {
  active: boolean;
  showPulse: boolean;
  onClick: () => void;
}

export function SimSetupButton({
  active,
  showPulse,
  onClick,
}: SimSetupButtonProps) {
  return (
    <div
      className="relative flex items-center px-3"
      style={{
        background: active
          ? undefined
          : "radial-gradient(circle at 50% 120%, rgba(164,168,255,0.18), transparent 70%)",
      }}
    >
      <button
        type="button"
        aria-label="Sim setup"
        aria-expanded={active}
        onClick={onClick}
        className={[
          "relative flex items-center gap-[9px] rounded-[10px] py-2 pr-4 pl-[14px] text-[13px] font-semibold transition-colors",
          active
            ? "text-hi border border-[rgba(164,168,255,0.55)]"
            : "text-[#16182a] border border-[rgba(196,200,255,0.85)]",
        ].join(" ")}
        style={{
          background: active
            ? "linear-gradient(180deg, rgba(164,168,255,0.28) 0%, rgba(164,168,255,0.18) 100%)"
            : "linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)",
          letterSpacing: "-0.005em",
          boxShadow: active
            ? undefined
            : "0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.50), inset 0 1px 0 rgba(255,255,255,0.55)",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="2.5" />
          <path d="M11 2.5v2.5M11 17v2.5M2.5 11h2.5M17 11h2.5M5 5l1.8 1.8M15.2 15.2L17 17M5 17l1.8-1.8M15.2 6.8L17 5" />
        </svg>
        <span>Sim setup</span>
        {showPulse && !active && (
          <span
            aria-hidden
            className="absolute -top-[3px] -right-[3px] h-[9px] w-[9px] rounded-full bg-white"
            style={{
              boxShadow:
                "0 0 0 2px rgba(164,168,255,0.55), 0 0 8px rgba(255,255,255,0.8)",
            }}
          />
        )}
      </button>
    </div>
  );
}
