"use client";

import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/app/store/Store";
import {
  type CelestialBodyProperties,
  setActiveBody,
  setIsBodyActive,
  selectActiveBodyName,
  selectIsBodyActive,
  selectCelestialBodyPropertiesList,
} from "@/app/store/slices/SimulationSlice";
import {
  BODY_ORDER,
  BODY_DISPLAY,
  bodyGradient,
  toBodyKey,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import { MOBILE_INSPECT_TOUR_TARGET } from "@/app/constants/mobileTourSteps";

const accent = "var(--color-accent)";
// Distance-from-sun rank for every known body, for the canonical rail order.
const ORDER_INDEX = new Map<BodyKey, number>(
  BODY_ORDER.map((k, i) => [k, i]),
);

// A persistent, full-width strip of lit-sphere icons at the top of the mobile
// chrome: tap a body to inspect it without chasing a moving planet. Pure
// presentation, it dispatches selection but holds no state of its own.
export function MobilePlanetRail() {
  const dispatch = useDispatch<AppDispatch>();
  const bodies = useSelector(selectCelestialBodyPropertiesList);
  const activeName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);

  // Bodies present in this sim, mapped to a known visual key plus their wire
  // name, sorted by canonical distance-from-sun order. Recomputed only when the
  // body list reference changes (the selector returns a stable ref per sim).
  const items = useMemo(() => {
    return bodies
      .map((b: CelestialBodyProperties) => {
        const key = b.name ? toBodyKey(b.name) : null;
        return key && b.name ? { key, name: b.name } : null;
      })
      .filter((x): x is { key: BodyKey; name: string } => x !== null)
      .sort((a, b) => ORDER_INDEX.get(a.key)! - ORDER_INDEX.get(b.key)!);
  }, [bodies]);

  if (items.length === 0) return null;

  const activeUpper = isBodyActive
    ? (activeName?.trim().toUpperCase() ?? "")
    : "";

  const onTap = (name: string) => {
    if (name.trim().toUpperCase() === activeUpper) {
      dispatch(setIsBodyActive(false)); // toggle the active body off
    } else {
      dispatch(setActiveBody(name));
    }
  };

  return (
    <nav
      aria-label="Pick a body to inspect"
      data-tour={MOBILE_INSPECT_TOUR_TARGET}
      className="pointer-events-auto fixed inset-x-0 top-0 z-20 flex items-center gap-2 overflow-x-auto"
      style={{
        // Pad in past every edge's safe area: the notch on top, and the
        // rounded corners / side notch when the phone is held in landscape.
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
        paddingBottom: 10,
        paddingLeft: "calc(env(safe-area-inset-left, 0px) + 12px)",
        paddingRight: "calc(env(safe-area-inset-right, 0px) + 12px)",
        background: "rgba(14,16,24,0.55)",
        backdropFilter: "blur(22px) saturate(150%)",
        WebkitBackdropFilter: "blur(22px) saturate(150%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        // Center the icons as a group. "safe" falls back to start-alignment when
        // a sim loads more bodies than fit (moons, Pluto) so the leading icons
        // are never clipped out of reach; the row just scrolls from the start.
        justifyContent: "safe center",
      }}
    >
      {items.map(({ key, name }) => {
        const isActive = name.trim().toUpperCase() === activeUpper;
        return (
          <button
            key={key}
            type="button"
            aria-label={BODY_DISPLAY[key]}
            aria-pressed={isActive}
            onClick={() => onTap(name)}
            className="grid flex-none place-items-center rounded-full transition-transform active:scale-95"
            style={{
              width: 30,
              height: 30,
              background: bodyGradient(key),
              boxShadow: isActive
                ? `0 0 0 2px var(--color-bg), 0 0 0 4px ${accent}`
                : "0 0 0 1px rgba(255,255,255,0.14)",
            }}
          />
        );
      })}
    </nav>
  );
}
