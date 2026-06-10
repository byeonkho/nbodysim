"use client";

import * as Popover from "@radix-ui/react-popover";
import { useDispatch, useSelector } from "react-redux";
import {
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  setActiveBody,
} from "@/app/store/slices/SimulationSlice";
import {
  BODY_CATEGORY,
  BODY_DISPLAY,
  BODY_ORDER,
  type BodyCategory,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import {
  ALL_MOONS,
  MOON_PARENT_LABEL,
  MOON_PARENT_ORDER,
  MOONS_BY_PARENT,
  PLANET_KEYS,
} from "@/app/constants/BodyCatalog";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Pill row showing the bodies currently in the sim, grouped by kind:
//   - Planets (Sun + the eight) render inline as individual chips — the
//     canonical solar-system framing, always 1:1 with what's enabled.
//   - Moons collapse to one group chip whose popover sub-groups by parent.
//   - Dwarf planets and near-Earth asteroids each collapse to a group chip too.
// Group chips render only when their kind has at least one enabled body, so the
// row stays compact and tracks what the user actually picked. Clicking any pill
// sets the inspected body (drives the body card + reticle). Scene-click also
// selects bodies, so this row is a tracked-set readout + quick-jump, not the
// only way to inspect.

// Plain-English labels for the minor-body group chips + popover headers.
const CATEGORY_GROUP_LABEL: Record<BodyCategory, string> = {
  planet: "Planets",
  dwarfPlanet: "Dwarf planets",
  asteroid: "Asteroids",
};

export function BodySelector() {
  const dispatch = useDispatch();
  const activeName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const enabledList = useSelector(selectCelestialBodyPropertiesList) ?? [];

  const enabled = new Set<string>(
    (enabledList as CelestialBodyProperties[])
      .map((b) => b.name?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s)),
  );

  const activeKey = activeName?.trim().toUpperCase();

  // Planets (Sun + eight) inline; moons separated into their own group; dwarf
  // and asteroid kept as their own groups. Moons share the backend "planet"
  // category, so they must be split out explicitly rather than via BODY_CATEGORY.
  const enabledPlanets = PLANET_KEYS.filter((k) => enabled.has(k));
  const enabledMoons = ALL_MOONS.filter((k) => enabled.has(k));
  const enabledByMinorCategory: Record<"dwarfPlanet" | "asteroid", BodyKey[]> = {
    dwarfPlanet: [],
    asteroid: [],
  };
  for (const key of BODY_ORDER) {
    if (!enabled.has(key)) continue;
    const cat = BODY_CATEGORY[key];
    if (cat === "dwarfPlanet" || cat === "asteroid") {
      enabledByMinorCategory[cat].push(key);
    }
  }

  const handleSelect = (key: BodyKey) => {
    dispatch(setActiveBody(BODY_DISPLAY[key]));
  };

  return (
    <div
      data-tour="body-selector"
      className="glass pointer-events-auto absolute top-[74px] left-1/2 flex -translate-x-1/2 items-center gap-0.5 p-1.5"
      style={{ borderRadius: 9999 }}
    >
      {/* Planets render inline. */}
      {enabledPlanets.map((key) => {
        const isActive = isBodyActive && activeKey === key;
        return (
          <BodyPill
            key={key}
            bodyKey={key}
            active={isActive}
            onClick={() => handleSelect(key)}
          />
        );
      })}

      {/* Moons collapse into one group chip; the popover sub-groups by parent. */}
      {enabledMoons.length > 0 && (
        <MoonGroupChip
          enabledMoons={enabledMoons}
          activeKey={isBodyActive ? activeKey : undefined}
          onSelect={handleSelect}
        />
      )}

      {/* Minor-body categories collapse into a single group chip each. */}
      {(["dwarfPlanet", "asteroid"] as const).map((category) => {
        const bodies = enabledByMinorCategory[category];
        if (bodies.length === 0) return null;
        const containsActive = bodies.some((k) => k === activeKey);
        const groupActive = isBodyActive && containsActive;
        return (
          <BodyGroupChip
            key={category}
            label={CATEGORY_GROUP_LABEL[category]}
            count={bodies.length}
            bodies={bodies}
            activeKey={isBodyActive ? activeKey : undefined}
            groupActive={groupActive}
            onSelect={handleSelect}
          />
        );
      })}
    </div>
  );
}

function BodyPill({
  bodyKey,
  active,
  onClick,
}: {
  bodyKey: BodyKey;
  active: boolean;
  onClick: () => void;
}) {
  const cls = [
    "flex items-center gap-2 rounded-full border px-[13px] py-[7px] transition-colors",
    active
      ? "bg-[rgba(164,168,255,0.14)] border-[rgba(164,168,255,0.32)]"
      : "border-transparent hover:bg-white/[0.04]",
  ].join(" ");

  return (
    <button type="button" onClick={onClick} className={cls}>
      <BodySphere body={bodyKey} size={13} glow={active} />
      <span
        className={
          active
            ? "text-hi text-[12px] font-semibold"
            : "text-[12px] font-medium text-[#b1b4be]"
        }
      >
        {BODY_DISPLAY[bodyKey]}
      </span>
    </button>
  );
}

// Group chip for a flat minor-body category (dwarf planets, asteroids).
function BodyGroupChip({
  label,
  count,
  bodies,
  activeKey,
  groupActive,
  onSelect,
}: {
  label: string;
  count: number;
  bodies: BodyKey[];
  activeKey: string | undefined;
  groupActive: boolean;
  onSelect: (key: BodyKey) => void;
}) {
  return (
    <GroupChipShell
      representative={bodies[0]}
      label={label}
      count={count}
      groupActive={groupActive}
    >
      <p className="eyebrow text-dim px-2 pt-1 pb-1.5">{label}</p>
      {bodies.map((key) => (
        <BodyPill
          key={key}
          bodyKey={key}
          active={activeKey === key}
          onClick={() => onSelect(key)}
        />
      ))}
    </GroupChipShell>
  );
}

// Group chip for moons: popover content sub-grouped by parent body.
function MoonGroupChip({
  enabledMoons,
  activeKey,
  onSelect,
}: {
  enabledMoons: BodyKey[];
  activeKey: string | undefined;
  onSelect: (key: BodyKey) => void;
}) {
  const groupActive = Boolean(
    activeKey && enabledMoons.some((k) => k === activeKey),
  );

  return (
    <GroupChipShell
      representative={enabledMoons[0]}
      label="Moons"
      count={enabledMoons.length}
      groupActive={groupActive}
    >
      {MOON_PARENT_ORDER.map((parent) => {
        const moons = MOONS_BY_PARENT[parent].filter((k) =>
          enabledMoons.includes(k),
        );
        if (moons.length === 0) return null;
        return (
          <div key={parent} className="flex flex-col gap-0.5">
            <p className="eyebrow text-dim px-2 pt-1 pb-1.5">
              {MOON_PARENT_LABEL[parent]}
            </p>
            {moons.map((key) => (
              <BodyPill
                key={key}
                bodyKey={key}
                active={activeKey === key}
                onClick={() => onSelect(key)}
              />
            ))}
          </div>
        );
      })}
    </GroupChipShell>
  );
}

// Shared popover-chip shell: a trigger pill (representative sphere + label +
// count + caret) and the popover surface that wraps the supplied content.
function GroupChipShell({
  representative,
  label,
  count,
  groupActive,
  children,
}: {
  representative: BodyKey;
  label: string;
  count: number;
  groupActive: boolean;
  children: React.ReactNode;
}) {
  const triggerCls = [
    "flex items-center gap-2 rounded-full border px-[13px] py-[7px] transition-colors",
    "data-[state=open]:bg-[rgba(164,168,255,0.10)]",
    groupActive
      ? "bg-[rgba(164,168,255,0.14)] border-[rgba(164,168,255,0.32)]"
      : "border-transparent hover:bg-white/[0.04]",
  ].join(" ");

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={triggerCls}>
          <BodySphere body={representative} size={13} glow={groupActive} />
          <span
            className={
              groupActive
                ? "text-hi text-[12px] font-semibold"
                : "text-[12px] font-medium text-[#b1b4be]"
            }
          >
            {label}
          </span>
          <span
            className="text-[11px] font-medium text-[#8c8f99]"
            style={{ marginLeft: 2 }}
          >
            {count}
          </span>
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[#8c8f99]"
            aria-hidden
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={6}
          className="glass pointer-events-auto z-50 flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto p-1.5"
          style={{ borderRadius: 14 }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
