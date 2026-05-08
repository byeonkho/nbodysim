"use client";

import { useDispatch, useSelector } from "react-redux";
import {
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  setActiveBody,
} from "@/app/store/slices/SimulationSlice";
import {
  BODY_DISPLAY,
  BODY_NAIF,
  BODY_ORDER,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Pill row of all 10 canonical bodies. Bodies enabled in the active sim
// are interactive; the rest dim out so the n-body framing is always
// visible without surprising the user with mid-sim wiring decisions.

export function BodySelector() {
  const dispatch = useDispatch();
  const activeName = useSelector(selectActiveBodyName);
  const enabledList = useSelector(selectCelestialBodyPropertiesList) ?? [];

  const enabled = new Set<string>(
    (enabledList as CelestialBodyProperties[])
      .map((b) => b.name?.trim().toUpperCase())
      .filter((s): s is string => Boolean(s)),
  );

  const activeKey = activeName?.trim().toUpperCase();

  return (
    <div
      className="glass pointer-events-auto absolute top-[74px] left-1/2 flex -translate-x-1/2 items-center gap-0.5 p-1.5"
      style={{ borderRadius: 9999 }}
    >
      {BODY_ORDER.map((key) => {
        const isEnabled = enabled.has(key);
        const isActive = isEnabled && activeKey === key;
        return (
          <BodyPill
            key={key}
            bodyKey={key}
            active={isActive}
            disabled={!isEnabled}
            onClick={() => dispatch(setActiveBody(BODY_DISPLAY[key]))}
          />
        );
      })}
    </div>
  );
}

function BodyPill({
  bodyKey,
  active,
  disabled,
  onClick,
}: {
  bodyKey: BodyKey;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const cls = [
    "flex items-center gap-2 rounded-full border px-[13px] py-[7px] transition-colors",
    active
      ? "bg-[rgba(164,168,255,0.14)] border-[rgba(164,168,255,0.32)]"
      : "border-transparent hover:bg-white/[0.04]",
    disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cls}>
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
      {active && (
        <span className="tabular text-subdim ml-0.5 font-mono text-[9px]">
          {BODY_NAIF[bodyKey]}
        </span>
      )}
    </button>
  );
}
