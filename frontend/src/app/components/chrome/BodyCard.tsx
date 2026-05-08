"use client";

import { useEffect, useRef } from "react";
import { useSelector, useStore } from "react-redux";
import {
  type CelestialBody,
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import type { RootState } from "@/app/store/Store";
import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  subtractInto,
  toTitleCase,
} from "@/app/utils/helpers";
import {
  BODY_DISPLAY,
  BODY_NAIF,
  toBodyKey,
} from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Right-column body card. Identity (name, NAIF, orbiting body) comes from
// selectors and only changes on body switch. Numerics update at 5 Hz via
// DOM refs — subscribing to Redux per frame would force a React rerender
// of the whole card on every tick.
//
// Phase 3 (#59) appends Keplerian elements; Phase 5 (#60) appends
// integrator residuals. Both will live as additional sections below
// State vector.

const REFRESH_HZ_MS = 200;

export function BodyCard() {
  const activeName = useSelector(selectActiveBodyName);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const store = useStore<RootState>();

  const upperName = activeName?.trim().toUpperCase() ?? "";
  const activeProps = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";

  const rangeRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const rxRef = useRef<HTMLSpanElement>(null);
  const ryRef = useRef<HTMLSpanElement>(null);
  const vmagRef = useRef<HTMLSpanElement>(null);

  const velocityScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    if (!upperName || !activeProps || !orbitingNameUpper) return;

    const tick = () => {
      const state = store.getState();
      const data = state.simulation.simulationData;
      const key = selectCurrentTimeStepKey(state);
      if (!data || !key) return;
      const snapshot = data[key];
      if (!snapshot) return;

      const body = snapshot.find(
        (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
      );
      const orbiting = snapshot.find(
        (b: CelestialBody) =>
          b.name.trim().toUpperCase() === orbitingNameUpper,
      );
      if (!body || !orbiting) return;

      if (rangeRef.current) {
        rangeRef.current.textContent = calculateDistance(
          body.position,
          orbiting.position,
          "AU",
        );
      }

      subtractInto(velocityScratch.current, body.velocity, orbiting.velocity);
      const speedStr = formatToKM(calculateMagnitude(velocityScratch.current));
      if (speedRef.current) speedRef.current.textContent = speedStr;
      if (vmagRef.current) vmagRef.current.textContent = speedStr;

      if (rxRef.current)
        rxRef.current.textContent = formatScientificKm(body.position.x);
      if (ryRef.current)
        ryRef.current.textContent = formatScientificKm(body.position.y);
    };
    tick();
    const id = window.setInterval(tick, REFRESH_HZ_MS);
    return () => window.clearInterval(id);
  }, [store, upperName, orbitingNameUpper, activeProps]);

  if (!upperName || !activeProps) {
    return <BodyCardEmpty />;
  }

  const bodyKey = toBodyKey(upperName);
  const naif = bodyKey ? BODY_NAIF[bodyKey] : "—";
  const display = bodyKey
    ? BODY_DISPLAY[bodyKey]
    : toTitleCase(activeName ?? "");
  const orbitingDisplay = orbitingNameUpper
    ? toTitleCase(orbitingNameUpper)
    : "—";

  return (
    <div
      className="glass px-[18px] pt-4 pb-3.5"
      style={{ borderRadius: 14 }}
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        {bodyKey && <BodySphere body={bodyKey} size={18} glow />}
        <div className="text-hi text-[17px] font-semibold tracking-[-0.015em]">
          {display}
        </div>
        <div className="flex-1" />
        <div className="text-subdim tabular font-mono text-[10px] tracking-[0.04em]">
          NAIF · {naif}
        </div>
      </div>

      <div className="text-dim mb-1.5 text-[11px] leading-[1.55]">
        Tracking in heliocentric frame.
      </div>

      <SectionLabel>State vector · J2000</SectionLabel>
      <KvRow k={`Range to ${orbitingDisplay}`} valueRef={rangeRef} />
      <KvRow k="Speed" valueRef={speedRef} accent />
      <KvRow k="r⃗ · x" valueRef={rxRef} />
      <KvRow k="r⃗ · y" valueRef={ryRef} />
      <KvRow k="v⃗ · ‖" valueRef={vmagRef} />
    </div>
  );
}

function BodyCardEmpty() {
  return (
    <div
      className="glass px-[18px] pt-4 pb-3.5"
      style={{ borderRadius: 14 }}
    >
      <div className="text-dim text-[11px]">Select a body to inspect.</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-subdim mt-3 mb-1 border-t border-dashed border-white/[0.06] pt-2.5 text-[9px] font-semibold tracking-[0.18em] uppercase">
      {children}
    </div>
  );
}

function KvRow({
  k,
  valueRef,
  accent,
}: {
  k: string;
  valueRef: React.RefObject<HTMLSpanElement | null>;
  accent?: boolean;
}) {
  return (
    <div
      className="grid items-baseline gap-3.5 py-1"
      style={{ gridTemplateColumns: "1fr auto" }}
    >
      <span className="text-dim text-[11px]">{k}</span>
      <span
        ref={valueRef}
        className={`tabular font-mono text-[12px] tracking-[-0.01em] ${accent ? "text-accent" : "text-hi"}`}
      />
    </div>
  );
}

function formatScientificKm(meters: number): string {
  if (!Number.isFinite(meters) || meters === 0) return "0 km";
  const km = meters / 1000;
  const exp = Math.floor(Math.log10(Math.abs(km)));
  const mantissa = km / Math.pow(10, exp);
  const sign = km < 0 ? "−" : "+";
  return `${sign}${Math.abs(mantissa).toFixed(3)}×10${superScript(exp)} km`;
}

function superScript(n: number): string {
  const map: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "-": "⁻",
  };
  return n
    .toString()
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
}
