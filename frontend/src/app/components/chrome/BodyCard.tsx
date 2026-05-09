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
import { computeOrbitalElements } from "@/app/utils/orbitalElements";
import { BODY_DISPLAY, toBodyKey } from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";

// Right-column body card. Identity (name, NAIF, orbiting body) comes from
// selectors and only changes on body switch. Numerics update at 5 Hz via
// DOM refs — subscribing to Redux per frame would force a React rerender
// of the whole card on every tick.
//
// Phase 5 (#60) will append integrator residuals as another section below
// Keplerian elements.

const REFRESH_HZ_MS = 200;
const AU_METRES = 1.495978707e11;
const RAD_TO_DEG = 180 / Math.PI;

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

  // Keplerian elements refs — populated only when the orbiting body's µ is
  // known. Sun rows render "—" because the Sun has no orbiting body in the
  // current scene topology.
  const semiMajorRef = useRef<HTMLSpanElement>(null);
  const eccentricityRef = useRef<HTMLSpanElement>(null);
  const inclinationRef = useRef<HTMLSpanElement>(null);
  const trueAnomalyRef = useRef<HTMLSpanElement>(null);
  const periodRef = useRef<HTMLSpanElement>(null);

  const velocityScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  // µ comes from the orbiting body's CelestialBodyProperties, which is
  // populated by SimulationSlice from the binary chunk header. May be
  // undefined briefly between body-switch and first chunk, so guard reads.
  const orbitingProps = propsList?.find(
    (p: CelestialBodyProperties) =>
      p.name?.trim().toUpperCase() === orbitingNameUpper,
  );
  const orbitingMu = orbitingProps?.mu;

  useEffect(() => {
    if (!upperName || !activeProps || !orbitingNameUpper) return;

    const writeDashes = () => {
      if (semiMajorRef.current) semiMajorRef.current.textContent = "—";
      if (eccentricityRef.current) eccentricityRef.current.textContent = "—";
      if (inclinationRef.current) inclinationRef.current.textContent = "—";
      if (trueAnomalyRef.current) trueAnomalyRef.current.textContent = "—";
      if (periodRef.current) periodRef.current.textContent = "—";
    };

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

      // Keplerian elements — only computable when µ for the orbiting body
      // is known (i.e. at least one chunk has been received and the slice
      // has merged µ into the props list). No µ → render dashes.
      if (orbitingMu && orbitingMu > 0) {
        const elements = computeOrbitalElements(
          body.position,
          body.velocity,
          orbiting.position,
          orbiting.velocity,
          orbitingMu,
        );
        if (elements) {
          if (semiMajorRef.current)
            semiMajorRef.current.textContent = formatSemiMajorAxis(
              elements.semiMajorAxis,
            );
          if (eccentricityRef.current)
            eccentricityRef.current.textContent =
              elements.eccentricity.toFixed(4);
          if (inclinationRef.current)
            inclinationRef.current.textContent = formatDegrees(
              elements.inclination * RAD_TO_DEG,
            );
          if (trueAnomalyRef.current)
            trueAnomalyRef.current.textContent = formatDegrees(
              elements.trueAnomaly * RAD_TO_DEG,
            );
          if (periodRef.current)
            periodRef.current.textContent = formatPeriod(elements.period);
        } else {
          // Degenerate state — can happen briefly mid-frame on snapshot
          // boundary issues; show dashes rather than NaN.
          writeDashes();
        }
      } else {
        writeDashes();
      }
    };

    tick();
    const id = window.setInterval(tick, REFRESH_HZ_MS);
    return () => window.clearInterval(id);
  }, [store, upperName, orbitingNameUpper, activeProps, orbitingMu]);

  if (!upperName || !activeProps) {
    return <BodyCardEmpty />;
  }

  const bodyKey = toBodyKey(upperName);
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

      <SectionLabel>Keplerian elements</SectionLabel>
      <KvRow k="Semi-major axis · a" valueRef={semiMajorRef} />
      <KvRow k="Eccentricity · e" valueRef={eccentricityRef} />
      <KvRow k="Inclination · i" valueRef={inclinationRef} />
      <KvRow k="True anomaly · ν" valueRef={trueAnomalyRef} />
      <KvRow k="Period · T" valueRef={periodRef} />
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

function formatSemiMajorAxis(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  if (metres < 0) return "hyperbolic";
  // Switch units at the Earth-Moon scale: AU below ~0.001 AU is unhelpful
  // (the Moon's a is ~0.00257 AU = 384 400 km — we want km for that one).
  const au = metres / AU_METRES;
  if (Math.abs(au) >= 0.01) {
    return `${au.toFixed(4)} AU`;
  }
  const km = metres / 1000;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

function formatDegrees(deg: number): string {
  if (!Number.isFinite(deg)) return "—";
  return `${deg.toFixed(2)}°`;
}

function formatPeriod(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const days = seconds / 86400;
  // Below 100 days, days reads cleaner; above, years.
  if (days < 100) {
    return `${days.toFixed(2)} d`;
  }
  const years = days / 365.25;
  return `${years.toFixed(2)} yr`;
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
