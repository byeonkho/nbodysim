"use client";

import { useDispatch, useSelector } from "react-redux";
import {
  type EventFilter,
  type EventSeverity,
  type LogEvent,
  selectEventFilter,
  selectFilteredEvents,
  setEventFilter,
} from "@/app/store/slices/EventLogSlice";
import {
  selectEventLogCollapsed,
  toggleEventLog,
} from "@/app/store/slices/UISlice";
import { CollapseChevron } from "@/app/components/chrome/CollapseChevron";

// Event log card. USR entries flow in via the userActionLogger
// middleware; SIM entries arrive in Phase 6 (#40). Filter chips reuse
// the chrome accent treatment; "view all →" footer link is reserved
// for a future paginated history view.

const FILTERS: readonly EventFilter[] = ["ALL", "SIM", "USR"];

export function EventLogCard() {
  const dispatch = useDispatch();
  const filter = useSelector(selectEventFilter);
  const events: LogEvent[] = useSelector(selectFilteredEvents);
  const collapsed = useSelector(selectEventLogCollapsed);
  const count = events.length;

  return (
    <div
      className={`glass flex flex-col p-0 ${collapsed ? "" : "max-h-[40vh]"}`}
      style={{ borderRadius: 14 }}
    >
      <div
        className={`flex items-center justify-between px-4 pt-3 pb-2.5 ${
          collapsed ? "" : "border-b border-white/[0.06]"
        }`}
      >
        <button
          type="button"
          onClick={() => dispatch(toggleEventLog())}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand event log" : "Collapse event log"}
          className="flex items-center gap-2"
        >
          <CollapseChevron collapsed={collapsed} />
          <span className="text-hi text-[12px] font-semibold tracking-[-0.01em]">
            Event log
          </span>
          <span className="text-subdim tabular rounded bg-white/[0.05] px-1.5 py-px font-mono text-[10px]">
            {count}
          </span>
        </button>
        {!collapsed && (
          <div className="flex gap-1">
            {FILTERS.map((t) => {
              const active = t === filter;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => dispatch(setEventFilter(t))}
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
        )}
      </div>
      {!collapsed && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto py-1.5">
            {count === 0 ? (
              <div className="flex h-full items-center justify-center px-4 py-6">
                <span className="text-subdim text-[10px] tracking-[0.05em] uppercase">
                  No events yet
                </span>
              </div>
            ) : (
              events.map((e) => <EventRow key={e.id} event={e} />)
            )}
          </div>
          <div className="text-subdim flex justify-between border-t border-white/[0.06] px-4 py-2 font-mono text-[10px]">
            <span>last 60m</span>
            <span className="text-dim cursor-pointer">view all →</span>
          </div>
        </>
      )}
    </div>
  );
}

function EventRow({ event }: { event: LogEvent }) {
  const time = formatHms(event.ts);
  const dotClass = severityDotClass(event.severity);
  const messageDimmed = event.severity === "info";
  return (
    <div className="flex items-baseline gap-2.5 px-4 py-[5px]">
      <span className="text-subdim tabular min-w-[54px] font-mono text-[10px]">
        {time}
      </span>
      <span className={`h-[5px] w-[5px] flex-shrink-0 self-center rounded-full ${dotClass}`} />
      <span
        className={[
          "flex-1 text-[11.5px] leading-[1.5] tracking-[-0.005em]",
          messageDimmed ? "text-dim" : "text-text",
        ].join(" ")}
      >
        {event.message}
      </span>
    </div>
  );
}

function severityDotClass(severity: EventSeverity): string {
  switch (severity) {
    case "user":
      return "bg-accent shadow-[0_0_6px_var(--color-accent)]";
    case "warn":
      return "bg-amber shadow-[0_0_6px_var(--color-amber)]";
    case "info":
    default:
      return "bg-white/[0.18]";
  }
}

function formatHms(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
