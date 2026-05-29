"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDispatch } from "react-redux";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setIsPaused, setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import {
  BODY_CATEGORY,
  BODY_DISPLAY,
  BODY_ORDER,
  type BodyCategory,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";
import { PlaybackQualityPicker } from "@/app/components/chrome/PlaybackQualityPicker";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import {
  INTEGRATOR_DEFAULT_BUCKETS,
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";

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

// Body picker is sectioned by category. Order mirrors the backend body
// classification (planets feel and exert gravity on each other; dwarf
// planets are massive minor bodies; near-Earth asteroids are tracked as
// test particles).
const CATEGORY_ORDER: readonly BodyCategory[] = ["planet", "dwarfPlanet", "asteroid"];

const CATEGORY_LABEL: Record<BodyCategory, string> = {
  planet: "Planets",
  dwarfPlanet: "Dwarf planets",
  asteroid: "Near-Earth asteroids",
};

// The Sun + 8 planets. These are the default first-paint selection (plus
// Earth's Moon, added in DEFAULT_SELECTED below).
const PLANET_KEYS: readonly BodyKey[] = [
  "SUN",
  "MERCURY",
  "VENUS",
  "EARTH",
  "MARS",
  "JUPITER",
  "SATURN",
  "URANUS",
  "NEPTUNE",
];

// Parents that host moons, in solar-system distance order. Each parent's
// moons render in a collapsible group directly beneath the parent body.
const MOON_PARENT_ORDER = [
  "EARTH",
  "MARS",
  "JUPITER",
  "SATURN",
  "URANUS",
  "NEPTUNE",
  "PLUTO",
] as const;

type MoonParent = (typeof MOON_PARENT_ORDER)[number];

const MOON_PARENT_LABEL: Record<MoonParent, string> = {
  EARTH: "Earth's moon",
  MARS: "Mars's moons",
  JUPITER: "Jupiter's moons",
  SATURN: "Saturn's moons",
  URANUS: "Uranus's moons",
  NEPTUNE: "Neptune's moons",
  PLUTO: "Pluto's moon",
};

// Which parent each moon slots under. Earth's Moon lives on the Orekit
// source path rather than the moon catalog, but for the drawer grouping it
// sits under Earth like any other moon.
const MOON_PARENT_OF: Partial<Record<BodyKey, MoonParent>> = {
  MOON: "EARTH",
  PHOBOS: "MARS",
  DEIMOS: "MARS",
  IO: "JUPITER",
  EUROPA: "JUPITER",
  GANYMEDE: "JUPITER",
  CALLISTO: "JUPITER",
  MIMAS: "SATURN",
  ENCELADUS: "SATURN",
  TETHYS: "SATURN",
  DIONE: "SATURN",
  RHEA: "SATURN",
  TITAN: "SATURN",
  IAPETUS: "SATURN",
  ARIEL: "URANUS",
  UMBRIEL: "URANUS",
  TITANIA: "URANUS",
  OBERON: "URANUS",
  MIRANDA: "URANUS",
  TRITON: "NEPTUNE",
  NEREID: "NEPTUNE",
  CHARON: "PLUTO",
};

const MOONS_BY_PARENT: Record<MoonParent, BodyKey[]> = MOON_PARENT_ORDER.reduce(
  (acc, p) => {
    acc[p] = [];
    return acc;
  },
  {} as Record<MoonParent, BodyKey[]>,
);
for (const key of BODY_ORDER) {
  const p = MOON_PARENT_OF[key];
  if (p) MOONS_BY_PARENT[p].push(key);
}

const MOON_PARENT_SET = new Set<string>(MOON_PARENT_ORDER);
const isMoonParent = (key: BodyKey): key is MoonParent =>
  MOON_PARENT_SET.has(key);
const moonsOf = (key: BodyKey): readonly BodyKey[] =>
  isMoonParent(key) ? MOONS_BY_PARENT[key] : [];

// Top-level (non-moon) bodies per category, in catalog order. Moons are
// excluded here because they render nested under their parent rather than as
// standalone section entries.
const TOP_LEVEL_BY_CATEGORY: Record<BodyCategory, BodyKey[]> = {
  planet: [],
  dwarfPlanet: [],
  asteroid: [],
};
for (const key of BODY_ORDER) {
  if (!MOON_PARENT_OF[key]) TOP_LEVEL_BY_CATEGORY[BODY_CATEGORY[key]].push(key);
}

// Everything a section "owns" for its master toggle + count: each top-level
// body plus the moons nested under it. A moon counts under its parent's
// section, so Charon counts under the Dwarf planets section (its parent Pluto
// lives there) even though Charon's own category is "planet".
const SECTION_MEMBERS: Record<BodyCategory, BodyKey[]> = {
  planet: [],
  dwarfPlanet: [],
  asteroid: [],
};
for (const category of CATEGORY_ORDER) {
  for (const body of TOP_LEVEL_BY_CATEGORY[category]) {
    SECTION_MEMBERS[category].push(body, ...moonsOf(body));
  }
}

// Default first-paint selection: Sun + 8 planets + Earth's Moon. A moonless
// Earth looks wrong to casual visitors, so the Moon stays in. The other 20
// moons are opt-in via the per-parent sub-headers, which keeps a default Run
// from fanning out 20 extra queries to JPL Horizons.
const DEFAULT_SELECTED: BodyKey[] = [...PLANET_KEYS, "MOON"];

interface SimSetupDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SimSetupDrawer({ open, onOpenChange }: SimSetupDrawerProps) {
  const dispatch = useDispatch<AppDispatch>();

  const [selectedBodies, setSelectedBodies] = useState<Set<BodyKey>>(
    new Set(DEFAULT_SELECTED),
  );
  const [date, setDate] = useState("2024-06-05T00:00:00.000");
  const [frame, setFrame] = useState("Heliocentric");
  const [integrator, setIntegrator] = useState<string>("rk4");
  const [timeStepUnit, setTimeStepUnit] =
    useState<(typeof TIME_UNITS)[number]>("Hours");
  const [fidelityBucket, setFidelityBucket] = useState<FidelityBucket>(
    INTEGRATOR_DEFAULT_BUCKETS[integrator] ?? "medLow",
  );

  // Reset bucket to the new integrator's landing default whenever
  // integrator changes. React-canonical "adjusting state when a prop
  // changes" pattern — setState during render (guarded by a change
  // check) rather than useEffect, to satisfy this repo's
  // react-hooks/set-state-in-effect lint rule and produce a single
  // render with the new default instead of a flash of the stale value.
  const [prevIntegrator, setPrevIntegrator] = useState<string>(integrator);
  if (prevIntegrator !== integrator) {
    setPrevIntegrator(integrator);
    const defaultBucket = INTEGRATOR_DEFAULT_BUCKETS[integrator];
    if (defaultBucket) {
      setFidelityBucket(defaultBucket);
    }
  }

  const toggleBody = (key: BodyKey) => {
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Bulk enable/disable for a whole section (its top-level bodies plus all
  // moons nested under them), driven by the master toggle on each section
  // header. Mixed state clicks always go to "all on" — matches the macOS
  // convention.
  const setCategoryEnabled = (category: BodyCategory, enable: boolean) => {
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      for (const key of SECTION_MEMBERS[category]) {
        if (enable) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  // Bulk enable/disable for one parent's moons, driven by the master toggle
  // on each per-parent moon group.
  const setParentMoonsEnabled = (parent: MoonParent, enable: boolean) => {
    setSelectedBodies((prev) => {
      const next = new Set(prev);
      for (const key of MOONS_BY_PARENT[parent]) {
        if (enable) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  // Which per-parent moon groups are expanded. Collapsed by default so the
  // body list stays compact; the group header still shows each group's
  // selected count and master toggle while collapsed.
  const [expandedParents, setExpandedParents] = useState<Set<MoonParent>>(
    new Set(),
  );
  const toggleParentExpanded = (parent: MoonParent) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
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
        fidelityBucket,
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
      // Auto-start: animation gates on `isPaused` AND a populated buffer,
      // so setting this now lets the controller spring into motion the
      // instant the first chunk arrives, instead of waiting for a manual
      // play click.
      dispatch(setIsPaused(false));
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

            <Field
              label={
                <span className="flex items-center gap-1.5">
                  Playback quality
                  <InfoTooltip label="What is playback quality?">
                    Lower quality ships fewer keyframes — smaller payloads,
                    smoother bandwidth, but motion between samples is
                    interpolated. Higher quality ships every step.
                  </InfoTooltip>
                </span>
              }
            >
              <PlaybackQualityPicker
                bucket={fidelityBucket}
                onChange={setFidelityBucket}
              />
            </Field>

            <p className="eyebrow mt-5 mb-2 px-1">
              BODIES · {selectedBodies.size} ENABLED
            </p>
            {CATEGORY_ORDER.map((category) => {
              const topLevel = TOP_LEVEL_BY_CATEGORY[category];
              if (topLevel.length === 0) return null;
              const members = SECTION_MEMBERS[category];
              const enabledInSection = members.filter((k) =>
                selectedBodies.has(k),
              ).length;
              const masterState: ToggleState =
                enabledInSection === 0
                  ? "off"
                  : enabledInSection === members.length
                    ? "on"
                    : "mixed";
              return (
                <div key={category} className="mb-3 last:mb-0">
                  <button
                    type="button"
                    onClick={() => setCategoryEnabled(category, masterState !== "on")}
                    aria-label={
                      masterState === "on"
                        ? `Deselect all ${CATEGORY_LABEL[category]}`
                        : `Select all ${CATEGORY_LABEL[category]}`
                    }
                    className="mb-1.5 flex w-full items-center px-1"
                  >
                    <span className="eyebrow text-dim flex-1 text-left">
                      {CATEGORY_LABEL[category]}{" "}
                      <span className="text-dim/70 normal-case tracking-normal">
                        ({enabledInSection}/{members.length})
                      </span>
                    </span>
                    <ToggleSwitch state={masterState} />
                  </button>
                  <BodyTree
                    topLevel={topLevel}
                    selectedBodies={selectedBodies}
                    expandedParents={expandedParents}
                    onToggleBody={toggleBody}
                    onToggleExpand={toggleParentExpanded}
                    onToggleParentMoons={setParentMoonsEnabled}
                  />
                </div>
              );
            })}
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
              className="flex flex-1 items-center justify-center gap-2 rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-[#16182a] disabled:cursor-not-allowed disabled:opacity-50"
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
  label: React.ReactNode;
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

type TreeRow =
  | { kind: "body"; key: BodyKey }
  | { kind: "moonHeader"; parent: MoonParent; moons: readonly BodyKey[] }
  | { kind: "moonChip"; key: BodyKey };

// One bordered box per section. Renders each top-level body as a chip, and
// directly beneath any parent that has moons, a collapsible "Moons" group
// (header + master toggle; moon chips when expanded). Left padding marks the
// nesting: body chips, then the group header, then the moon chips.
function BodyTree({
  topLevel,
  selectedBodies,
  expandedParents,
  onToggleBody,
  onToggleExpand,
  onToggleParentMoons,
}: {
  topLevel: readonly BodyKey[];
  selectedBodies: Set<BodyKey>;
  expandedParents: Set<MoonParent>;
  onToggleBody: (key: BodyKey) => void;
  onToggleExpand: (parent: MoonParent) => void;
  onToggleParentMoons: (parent: MoonParent, enable: boolean) => void;
}) {
  const rows: TreeRow[] = [];
  for (const body of topLevel) {
    rows.push({ kind: "body", key: body });
    if (isMoonParent(body)) {
      const moons = MOONS_BY_PARENT[body];
      if (moons.length > 0) {
        rows.push({ kind: "moonHeader", parent: body, moons });
        if (expandedParents.has(body)) {
          for (const m of moons) rows.push({ kind: "moonChip", key: m });
        }
      }
    }
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/[0.05]"
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      {rows.map((row, i) => {
        const withBorder = i < rows.length - 1;

        if (row.kind === "moonHeader") {
          const enabledMoons = row.moons.filter((k) =>
            selectedBodies.has(k),
          ).length;
          const master: ToggleState =
            enabledMoons === 0
              ? "off"
              : enabledMoons === row.moons.length
                ? "on"
                : "mixed";
          const expanded = expandedParents.has(row.parent);
          return (
            <div
              key={`moons-${row.parent}`}
              className={[
                "flex items-center py-2.5 pr-3.5 pl-9",
                withBorder && "border-b border-white/[0.04]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                onClick={() => onToggleExpand(row.parent)}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${MOON_PARENT_LABEL[row.parent]}`}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                <Chevron expanded={expanded} />
                <span className="eyebrow text-dim">
                  Moons{" "}
                  <span className="text-dim/70 normal-case tracking-normal">
                    ({enabledMoons}/{row.moons.length})
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleParentMoons(row.parent, master !== "on")}
                aria-label={
                  master === "on"
                    ? `Deselect ${MOON_PARENT_LABEL[row.parent]}`
                    : `Select ${MOON_PARENT_LABEL[row.parent]}`
                }
              >
                <ToggleSwitch state={master} />
              </button>
            </div>
          );
        }

        const enabled = selectedBodies.has(row.key);
        const indented = row.kind === "moonChip";
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onToggleBody(row.key)}
            className={[
              "flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-white/[0.02]",
              indented ? "pr-3.5 pl-12" : "px-3.5",
              withBorder && "border-b border-white/[0.04]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <BodySphere body={row.key} size={14} />
            <span
              className={
                enabled
                  ? "text-hi flex-1 text-[14px]"
                  : "text-dim flex-1 text-[14px]"
              }
            >
              {BODY_DISPLAY[row.key]}
            </span>
            <ToggleSwitch state={enabled ? "on" : "off"} />
          </button>
        );
      })}
    </div>
  );
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-dim transition-transform"
      style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
      aria-hidden
    >
      <path d="M3.5 1.5L7 5l-3.5 3.5" />
    </svg>
  );
}

type ToggleState = "off" | "on" | "mixed";

function ToggleSwitch({ state }: { state: ToggleState }) {
  // Mixed = knob centered + accent-tinted background + a dash indicator
  // on the knob so the state is visually distinct from both off and on.
  // Click semantics (mixed → on) live in the parent; this is presentation
  // only.
  const knobLeft = state === "on" ? 20 : state === "mixed" ? 11 : 2;
  const bg =
    state === "on"
      ? "var(--color-accent)"
      : state === "mixed"
        ? "rgba(164, 168, 255, 0.32)"
        : "rgba(255,255,255,0.10)";
  return (
    <span
      className="relative inline-block h-[26px] w-[44px] rounded-full transition-colors"
      style={{ background: bg }}
    >
      <span
        className="absolute top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-white transition-[left]"
        style={{ left: knobLeft, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
      >
        {state === "mixed" && (
          <span
            className="block"
            style={{
              width: 8,
              height: 2,
              borderRadius: 1,
              background: "rgba(146, 152, 238, 0.95)",
            }}
          />
        )}
      </span>
    </span>
  );
}
