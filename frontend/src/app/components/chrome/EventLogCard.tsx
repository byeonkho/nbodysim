"use client";

import { useState } from "react";

// Event log card — chrome only in Phase 1. The USR slice (frontend-only
// user events) lands in Phase 2 (#58); the SIM scanner that produces
// closest-approach / perihelion / conjunction entries lands in Phase 6
// (#40). Rendering structure here is what those will plug into.

type Filter = "ALL" | "SIM" | "USR";

export function EventLogCard() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const count = 0;

  return (
    <div
      className="glass flex min-h-0 flex-1 flex-col p-0"
      style={{ borderRadius: 14 }}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-hi text-[12px] font-semibold tracking-[-0.01em]">
            Event log
          </span>
          <span className="text-subdim tabular rounded bg-white/[0.05] px-1.5 py-px font-mono text-[10px]">
            {count}
          </span>
        </div>
        <div className="flex gap-1">
          {(["ALL", "SIM", "USR"] as const).map((t) => {
            const active = t === filter;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={[
                  "rounded-[5px] border px-2 py-[3px] font-mono text-[9px] tracking-[0.10em] transition-colors",
                  active
                    ? "bg-[rgba(164,168,255,0.10)] border-[rgba(164,168,255,0.20)] text-accent"
                    : "text-subdim border-transparent hover:bg-white/[0.04]",
                ].join(" ")}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <span className="text-subdim text-[10px] tracking-[0.05em] uppercase">
          No events yet
        </span>
      </div>
      <div className="text-subdim flex justify-between border-t border-white/[0.06] px-4 py-2 font-mono text-[10px]">
        <span>last 60m</span>
        <span className="text-dim cursor-pointer">view all →</span>
      </div>
    </div>
  );
}
