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
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Pill row showing the bodies currently in the sim, grouped by category:
//   - Planets render inline as individual chips (the canonical solar-system
//     framing — always 1:1 with whatever is enabled)
//   - Dwarf planets collapse to a single group chip with a popover that
//     reveals the per-body chips on click
//   - Near-Earth asteroids same pattern
// Group chips are only rendered when the category has at least one enabled
// body in the current sim. Empty categories disappear. That way the row
// stays compact and tracks what the user actually picked.

// Plain-English category labels for the group chips and popover headers.
// "Asteroids" rather than the technical "NEAs" — per the presentation-copy
// rule, prose stays accessible for non-technical visitors.
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

  // Partition the enabled bodies by category. BODY_ORDER drives display
  // ordering within a category — same source-of-truth the drawer uses.
  const enabledByCategory: Record<BodyCategory, BodyKey[]> = {
    planet: [],
    dwarfPlanet: [],
    asteroid: [],
  };
  for (const key of BODY_ORDER) {
    if (enabled.has(key)) enabledByCategory[BODY_CATEGORY[key]].push(key);
  }

  const handleSelect = (key: BodyKey) => {
    dispatch(setActiveBody(BODY_DISPLAY[key]));
  };

  return (
    <div
      className="glass pointer-events-auto absolute top-[74px] left-1/2 flex -translate-x-1/2 items-center gap-0.5 p-1.5"
      style={{ borderRadius: 9999 }}
    >
      {/* Planets render inline. */}
      {enabledByCategory.planet.map((key) => {
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

      {/* Minor-body categories collapse into a single group chip with a
          click-to-open popover. Order matches CATEGORY_GROUP_LABEL keys. */}
      {(["dwarfPlanet", "asteroid"] as const).map((category) => {
        const bodies = enabledByCategory[category];
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
          {/* The first enabled body in the group serves as the chip's
              visual representative — gives the group a "face" the user can
              recognize on a quick scan. */}
          <BodySphere body={bodies[0]} size={13} glow={groupActive} />
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
          className="glass pointer-events-auto z-50 flex flex-col gap-0.5 p-1.5"
          style={{ borderRadius: 14 }}
        >
          <p className="eyebrow text-dim px-2 pt-1 pb-1.5">{label}</p>
          {bodies.map((key) => {
            const isActive = activeKey === key;
            return (
              <BodyPill
                key={key}
                bodyKey={key}
                active={isActive}
                onClick={() => onSelect(key)}
              />
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
