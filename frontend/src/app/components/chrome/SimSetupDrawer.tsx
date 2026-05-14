"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDispatch } from "react-redux";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import {
  BODY_DISPLAY,
  BODY_ORDER,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Sim Setup drawer — left-anchored glass panel that owns the
// configure-and-Run flow. Replaces the centered Radix modal that was
// the entrypoint pre-redesign. Substrate is still Radix Dialog (gives
// us focus trap, Esc-to-close, click-outside-to-close, scroll lock,
// portal a11y for free) but with custom positioning + animation:
// anchored top-left under the top bar, slides in from the left over
// 200ms. Layout owns the open state. See spacesim-ui/
// design_handoff_sim_setup/.

const TIME_UNITS = ["Seconds", "Hours", "Days", "Weeks"] as const;
const INTEGRATORS = [
  ["euler", "Euler"],
  ["rk4", "RK4"],
  ["dp853", "DormandPrince853"],
] as const;

const ALL_BODIES = [...BODY_ORDER];

interface SimSetupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimSetupDrawer({ open, onOpenChange }: SimSetupDrawerProps) {
  const dispatch = useDispatch<AppDispatch>();

  const [selectedBodies, setSelectedBodies] = useState<Set<BodyKey>>(
    new Set(ALL_BODIES),
  );
  const [date, setDate] = useState("2024-06-05T00:00:00.000");
  const [frame, setFrame] = useState("Heliocentric");
  const [integrator, setIntegrator] = useState<string>("rk4");
  const [timeStepUnit, setTimeStepUnit] =
    useState<(typeof TIME_UNITS)[number]>("Hours");

  const toggleBody = (key: BodyKey) => {
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    const celestialBodyNames = Array.from(selectedBodies).map(
      (k) => BODY_DISPLAY[k],
    );
    if (celestialBodyNames.length === 0) {
      alert("Pick at least one body.");
      return;
    }
    try {
      const requestPayload = {
        celestialBodyNames,
        date,
        frame,
        integrator,
        timeStepUnit,
      };
      await initializeCelestialBodies(dispatch, requestPayload);
      const sessionID =
        store.getState().simulation.simulationParameters?.simulationMetaData
          ?.sessionID;
      if (!sessionID) throw new Error("Failed to initialize sim session.");
      // Persist the user's choices so the chrome (top status strip,
      // frame compass, BUFFER calc) can read them. Stays in slice across
      // chunk fetches; overwritten on the next Run.
      dispatch(setLastSimRequest(requestPayload));
      dispatchChunkRequest(dispatch, { sessionID });
      onOpenChange(false);
    } catch (err) {
      console.error("Sim params submit error:", err);
      alert(err instanceof Error ? err.message : "Submit failed");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Canvas scrim — subtle dim + 2px blur behind the drawer per
            handoff. Fades over the same 200ms as the drawer slide. */}
        <Dialog.Overlay
          className="fixed inset-0 z-40 transition-opacity duration-200 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100"
          style={{ background: "rgba(5,6,12,0.35)", backdropFilter: "blur(2px)" }}
        />
        <Dialog.Content
          className="fixed top-[80px] bottom-[114px] left-6 z-50 flex w-[440px] flex-col overflow-hidden transition-[transform,opacity] duration-200 ease-out data-[state=closed]:-translate-x-2 data-[state=closed]:opacity-0 data-[state=open]:translate-x-0 data-[state=open]:opacity-100"
          style={{
            background: "rgba(20,22,30,0.62)",
            backdropFilter: "blur(22px) saturate(150%)",
            WebkitBackdropFilter: "blur(22px) saturate(150%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 30px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(164,168,255,0.10)",
          }}
        >
          {/* Header — subtle indigo gradient wash, eyebrow + title + subtitle */}
          <div
            className="flex items-start justify-between border-b border-white/[0.06] px-5 pt-4 pb-3.5"
            style={{
              background:
                "linear-gradient(180deg, rgba(164,168,255,0.06) 0%, transparent 100%)",
            }}
          >
            <div className="flex flex-col gap-1">
              <p className="eyebrow text-accent" style={{ letterSpacing: "0.22em" }}>
                Simulation parameters
              </p>
              <Dialog.Title className="text-hi text-[18px] font-semibold tracking-[-0.015em]">
                Configure simulation
              </Dialog.Title>
              <Dialog.Description className="text-dim text-[11.5px] leading-[1.45]">
                Changes apply on Run. Epoch, frame and integrator define how the
                system evolves.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-dim hover:text-hi grid h-7 w-7 place-items-center rounded-full hover:bg-white/[0.05]"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <Field label="Epoch">
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-transparent text-[14px] text-hi outline-none"
                step="0.001"
              />
            </Field>

            <Field label="Frame">
              <input
                value={frame}
                onChange={(e) => setFrame(e.target.value)}
                className="w-full bg-transparent text-[14px] text-hi outline-none"
              />
            </Field>

            <Field
              label="Integrator"
              help="Euler is simple but drifts. RK4 is balanced. DP853 is adaptive."
            >
              <select
                value={integrator}
                onChange={(e) => setIntegrator(e.target.value)}
                className="w-full appearance-none bg-transparent text-[14px] text-hi outline-none"
              >
                {INTEGRATORS.map(([value, label]) => (
                  <option key={value} value={value} className="bg-bg">
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Time unit">
              <select
                value={timeStepUnit}
                onChange={(e) =>
                  setTimeStepUnit(
                    e.target.value as (typeof TIME_UNITS)[number],
                  )
                }
                className="w-full appearance-none bg-transparent text-[14px] text-hi outline-none"
              >
                {TIME_UNITS.map((u) => (
                  <option key={u} value={u} className="bg-bg">
                    {u}
                  </option>
                ))}
              </select>
            </Field>

            <p className="eyebrow mt-5 mb-2 px-1">
              BODIES · {selectedBodies.size} ENABLED
            </p>
            <div
              className="overflow-hidden rounded-xl border border-white/[0.05]"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              {ALL_BODIES.map((key, i) => {
                const enabled = selectedBodies.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleBody(key)}
                    className={[
                      "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.02]",
                      i < ALL_BODIES.length - 1 &&
                        "border-b border-white/[0.04]",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <BodySphere body={key} size={14} />
                    <span
                      className={
                        enabled
                          ? "text-hi flex-1 text-[14px]"
                          : "text-dim flex-1 text-[14px]"
                      }
                    >
                      {BODY_DISPLAY[key]}
                    </span>
                    <ToggleSwitch on={enabled} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer — primary Run is full-width per handoff (Save preset
              is out of scope this phase). Cancel removed; Esc / × / scrim
              click already cover the close path. */}
          <div
            className="flex items-center gap-3 border-t border-white/[0.06] px-5 py-3.5"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              className="flex flex-1 items-center justify-center gap-2 rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-[#16182a]"
              style={{
                background:
                  "linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)",
                border: "1px solid rgba(196,200,255,0.85)",
                boxShadow:
                  "0 0 0 3px rgba(164,168,255,0.18), 0 6px 20px rgba(146,152,238,0.50), inset 0 1px 0 rgba(255,255,255,0.55)",
                letterSpacing: "-0.005em",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="currentColor"
                aria-hidden
              >
                <path d="M3 2l8 4.5L3 11V2z" />
              </svg>
              <span>Run simulation</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3.5">
      <p className="eyebrow mb-1.5 px-1">{label}</p>
      <div
        className="rounded-xl border border-white/[0.08] px-3.5 py-3"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        {children}
      </div>
      {help && (
        <p className="text-dim mt-1.5 px-1 text-[11px] leading-[1.5]">{help}</p>
      )}
    </div>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className="relative inline-block h-[26px] w-[44px] rounded-full transition-colors"
      style={{
        background: on ? "var(--color-accent)" : "rgba(255,255,255,0.10)",
      }}
    >
      <span
        className="absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white transition-[left]"
        style={{
          left: on ? 20 : 2,
          boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }}
      />
    </span>
  );
}
