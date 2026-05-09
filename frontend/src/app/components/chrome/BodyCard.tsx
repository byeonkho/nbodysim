"use client";

import { useEffect, useRef } from "react";
import { useSelector, useStore } from "react-redux";
import {
  type CelestialBody,
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  selectDisplayFrame,
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

// Right-column body card. Identity (name, orbiting body) comes from
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
  const displayFrame = useSelector(selectDisplayFrame);
  const store = useStore<RootState>();

  const upperName = activeName?.trim().toUpperCase() ?? "";
  const activeProps = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";

  // State vector reference body — what range/speed/position are computed
  // against. Independent of Keplerian orbital reference (which is always
  // orbitingNameUpper, frame-invariant — orbital shape is a physical
  // characterization, not a viewing convention).
  //
  // Resolution rules:
  //   1. Moon is special-cased to Earth regardless of display frame —
  //      the Moon's natural reference body is always Earth, and showing
  //      its heliocentric position in helio mode is huge wobbly numbers
  //      that don't read as anything meaningful.
  //   2. In geo mode, every other body uses Earth as reference (matches
  //      the 3D scene's pivot — what you see is what's tabulated).
  //   3. In helio mode, every other body uses its orbitingBody (Sun for
  //      planets, leaving "Range to Sun" as the natural readout).
  //
  // Edge case: if the resolved reference IS the active body (Sun in
  // helio, Earth in geo), all state vector rows render "—" — there's
  // no meaningful self-relative measurement.
  const stateVectorRefNameUpper =
    upperName === "MOON"
      ? "EARTH"
      : displayFrame === "geo"
        ? "EARTH"
        : orbitingNameUpper;

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
    if (!upperName || !activeProps) return;

    const writeStateVectorDashes = () => {
      if (rangeRef.current) rangeRef.current.textContent = "—";
      if (speedRef.current) speedRef.current.textContent = "—";
      if (rxRef.current) rxRef.current.textContent = "—";
      if (ryRef.current) ryRef.current.textContent = "—";
      if (vmagRef.current) vmagRef.current.textContent = "—";
    };

    const writeKeplerianDashes = () => {
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
      if (!body) return;

      // State vector reference: skipped if the active body IS the
      // reference (no self-relative measurement makes sense), or if the
      // reference name resolves empty (Sun in helio: no orbitingBody).
      const stateRef =
        stateVectorRefNameUpper && stateVectorRefNameUpper !== upperName
          ? snapshot.find(
              (b: CelestialBody) =>
                b.name.trim().toUpperCase() === stateVectorRefNameUpper,
            )
          : undefined;

      if (stateRef) {
        if (rangeRef.current) {
          rangeRef.current.textContent = calculateDistance(
            body.position,
            stateRef.position,
            "AU",
          );
        }
        subtractInto(velocityScratch.current, body.velocity, stateRef.velocity);
        const speedStr = formatToKM(
          calculateMagnitude(velocityScratch.current),
        );
        if (speedRef.current) speedRef.current.textContent = speedStr;
        if (vmagRef.current) vmagRef.current.textContent = speedStr;
        if (rxRef.current)
          rxRef.current.textContent = formatScientificKm(
            body.position.x - stateRef.position.x,
          );
        if (ryRef.current)
          ryRef.current.textContent = formatScientificKm(
            body.position.y - stateRef.position.y,
          );
      } else {
        writeStateVectorDashes();
      }

      // Keplerian elements — uses the orbital reference body (orbitingNameUpper)
      // unconditionally. Frame-independent: orbit shape doesn't change because
      // you decided to look from somewhere else. µ comes from the orbiting body's
      // CelestialBodyProperties; if missing (no chunks yet) we render dashes.
      const orbiting = orbitingNameUpper
        ? snapshot.find(
            (b: CelestialBody) =>
              b.name.trim().toUpperCase() === orbitingNameUpper,
          )
        : undefined;

      if (orbiting && orbitingMu && orbitingMu > 0) {
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
          writeKeplerianDashes();
        }
      } else {
        writeKeplerianDashes();
      }
    };

    tick();
    const id = window.setInterval(tick, REFRESH_HZ_MS);
    return () => window.clearInterval(id);
  }, [
    store,
    upperName,
    orbitingNameUpper,
    stateVectorRefNameUpper,
    activeProps,
    orbitingMu,
  ]);

  if (!upperName || !activeProps) {
    return <BodyCardEmpty />;
  }

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey
    ? BODY_DISPLAY[bodyKey]
    : toTitleCase(activeName ?? "");
  // Range label reflects the state-vector reference body (frame-aware),
  // not the orbital reference. So Mars in geo says "Range to Earth"
  // even though the Keplerian section below still characterises Mars's
  // heliocentric orbit.
  const stateVectorRefDisplay = stateVectorRefNameUpper
    ? toTitleCase(stateVectorRefNameUpper)
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
        Tracking in {displayFrame === "geo" ? "geocentric" : "heliocentric"}{" "}
        frame.
      </div>

      <SectionLabel>State vector · J2000</SectionLabel>
      <KvRow k={`Range to ${stateVectorRefDisplay}`} valueRef={rangeRef} />
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
