"use client";

import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectDisplayFrame,
  selectIsBodyActive,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyStateInto, readBodyPositionInto, readDeltaERelativeAt } from "@/app/store/chunkBuffer";
import type { RootState } from "@/app/store/Store";
import {
  calculateDistance,
  calculateMagnitude,
  formatDeltaE,
  formatStepDuration,
  formatToKM,
  subtractInto,
  toTitleCase,
} from "@/app/utils/helpers";
import { computeOrbitalElements } from "@/app/utils/orbitalElements";
import { BODY_DISPLAY, toBodyKey } from "@/app/constants/BodyVisuals";
import {
  ACCEPT_RATE_COPY,
  AVG_STEP_COPY,
  RESIDUAL_CONCEPT_COPY,
} from "@/app/constants/residualTooltipCopy";
import { selectOverlayEnabled } from "@/app/store/slices/GroundTruthSlice";
import { driftMetrics } from "@/app/utils/driftMetrics";
import { DRIFT_READOUT_COPY } from "@/app/constants/driftTooltipCopy";
import {
  KEPLERIAN_COPY,
  STATE_VECTOR_COPY,
} from "@/app/constants/glossaryTooltipCopy";
import { BodyPortrait } from "@/app/components/chrome/BodyPortrait";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import {
  selectInfoPanelCollapsed,
  toggleInfoPanel,
} from "@/app/store/slices/UISlice";
import { CollapseChevron } from "@/app/components/chrome/CollapseChevron";

// Right-column body card. Identity (name, orbiting body) comes from
// selectors and only changes on body switch. Numerics update at 5 Hz via
// DOM refs — subscribing to Redux per frame would force a React rerender
// of the whole card on every tick.

const REFRESH_HZ_MS = 200;
const AU_METRES = 1.495978707e11;
const RAD_TO_DEG = 180 / Math.PI;

export function BodyCard() {
  const activeName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const displayFrame = useSelector(selectDisplayFrame);
  const store = useStore<RootState>();
  const dispatch = useDispatch();
  const infoCollapsed = useSelector(selectInfoPanelCollapsed);

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

  // Integrator residual refs — ΔE/E₀ always visible; DP853 telemetry rows
  // only render when the active integrator was adaptive.
  const residualDeltaERef = useRef<HTMLSpanElement>(null);
  const avgStepRef = useRef<HTMLSpanElement>(null);
  const acceptRateRef = useRef<HTMLSpanElement>(null);

  const driftKmRef = useRef<HTMLSpanElement>(null);
  const driftAngleRef = useRef<HTMLSpanElement>(null);

  const driftOverlayEnabled = useSelector(selectOverlayEnabled);

  // Visibility flag for the DP853 rows. Sourced reactively — flips at
  // chunk boundaries (not 5 Hz) so a normal useSelector is fine. The
  // values *inside* those rows are written to refs (no React rerender
  // when telemetry refreshes); only the show/hide flips trigger React.
  const dp853TelemetryActive = useSelector(
    (state: RootState) =>
      state.simulation.chunkBuffer?.dp853AvgStepSeconds != null,
  );

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
    if (!isBodyActive || !upperName || !activeProps) return;

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

    // Scratch THREE.Vector3s reused across tick() calls. BodyCard runs at 5Hz,
    // so per-tick allocation cost is small, but reuse keeps the code shape
    // consistent with the render-loop consumers.
    const bodyPos = new THREE.Vector3();
    const bodyVel = new THREE.Vector3();
    const stateRefPos = new THREE.Vector3();
    const stateRefVel = new THREE.Vector3();
    const orbitingPos = new THREE.Vector3();
    const orbitingVel = new THREE.Vector3();
    const trueScratch = new THREE.Vector3();

    const findIdx = (
      buffer: { bodyNameToIndex: ReadonlyMap<string, number> },
      nameUpper: string,
    ): number => {
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === nameUpper) return i;
      }
      return -1;
    };

    const tick = () => {
      const state = store.getState();
      const buffer = state.simulation.chunkBuffer;
      const idx = state.simulation.timeState.currentTimeStepIndex;
      if (!buffer || idx >= buffer.totalTimesteps) return;

      const bodyIdx = findIdx(buffer, upperName);
      if (bodyIdx < 0) return;
      readBodyStateInto(bodyPos, bodyVel, buffer, idx, bodyIdx);

      // State vector reference: skipped if the active body IS the
      // reference (no self-relative measurement makes sense), or if the
      // reference name resolves empty (Sun in helio: no orbitingBody).
      const stateRefIdx =
        stateVectorRefNameUpper && stateVectorRefNameUpper !== upperName
          ? findIdx(buffer, stateVectorRefNameUpper)
          : -1;

      if (stateRefIdx >= 0) {
        readBodyStateInto(stateRefPos, stateRefVel, buffer, idx, stateRefIdx);
        const bodyPosSimple: Vector3Simple = {
          x: bodyPos.x,
          y: bodyPos.y,
          z: bodyPos.z,
        };
        const stateRefPosSimple: Vector3Simple = {
          x: stateRefPos.x,
          y: stateRefPos.y,
          z: stateRefPos.z,
        };
        if (rangeRef.current) {
          rangeRef.current.textContent = calculateDistance(
            bodyPosSimple,
            stateRefPosSimple,
            "AU",
          );
        }
        subtractInto(
          velocityScratch.current,
          { x: bodyVel.x, y: bodyVel.y, z: bodyVel.z },
          { x: stateRefVel.x, y: stateRefVel.y, z: stateRefVel.z },
        );
        const speedStr = formatToKM(
          calculateMagnitude(velocityScratch.current),
        );
        if (speedRef.current) speedRef.current.textContent = speedStr;
        if (vmagRef.current) vmagRef.current.textContent = speedStr;
        if (rxRef.current)
          rxRef.current.textContent = formatScientificKm(
            bodyPos.x - stateRefPos.x,
          );
        if (ryRef.current)
          ryRef.current.textContent = formatScientificKm(
            bodyPos.y - stateRefPos.y,
          );
      } else {
        writeStateVectorDashes();
      }

      // Keplerian elements — uses the orbital reference body (orbitingNameUpper)
      // unconditionally. Frame-independent: orbit shape doesn't change because
      // you decided to look from somewhere else. µ comes from the orbiting body's
      // CelestialBodyProperties; if missing (no chunks yet) we render dashes.
      const orbitingIdx = orbitingNameUpper
        ? findIdx(buffer, orbitingNameUpper)
        : -1;

      if (orbitingIdx >= 0 && orbitingMu && orbitingMu > 0) {
        readBodyStateInto(orbitingPos, orbitingVel, buffer, idx, orbitingIdx);
        const elements = computeOrbitalElements(
          { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
          { x: bodyVel.x, y: bodyVel.y, z: bodyVel.z },
          { x: orbitingPos.x, y: orbitingPos.y, z: orbitingPos.z },
          { x: orbitingVel.x, y: orbitingVel.y, z: orbitingVel.z },
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

      // Integrator residual — same value as the top-strip cell. Read off
      // the buffer-relative play index (idx is already that — no need to
      // subtract bufferStartTimestep here because readBodyStateInto above
      // also treats idx as buffer-relative).
      if (residualDeltaERef.current) {
        residualDeltaERef.current.textContent = formatDeltaE(
          readDeltaERelativeAt(buffer, idx),
        );
      }
      // DP853 telemetry rows — only populated when the row is visible
      // (visibility itself flips via the useSelector above on chunk
      // arrival, so the refs are guaranteed mounted when we write).
      if (buffer.dp853AvgStepSeconds != null && avgStepRef.current) {
        avgStepRef.current.textContent = formatStepDuration(
          buffer.dp853AvgStepSeconds,
        );
      }
      if (buffer.dp853AcceptRate != null && acceptRateRef.current) {
        acceptRateRef.current.textContent = `${(buffer.dp853AcceptRate * 100).toFixed(1)}%`;
      }

      // Reality drift — predicted vs true position of the active body.
      // gt.overlayEnabled is read imperatively here (like the rest of tick);
      // the JSX section gates on the driftOverlayEnabled selector separately.
      const gt = state.groundTruth;
      if (
        gt.overlayEnabled &&
        gt.trueTrack &&
        gt.trueTrackBody === upperName &&
        idx < gt.trueTrack.totalTimesteps
      ) {
        readBodyPositionInto(trueScratch, gt.trueTrack, idx, 0); // single-body buffer
        const { km, angleDeg } = driftMetrics(
          { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
          { x: trueScratch.x, y: trueScratch.y, z: trueScratch.z },
        );
        if (driftKmRef.current) {
          driftKmRef.current.textContent =
            km >= 1e6
              ? `${(km / 1e6).toFixed(2)}M km`
              : `${Math.round(km).toLocaleString("en-US")} km`;
        }
        if (driftAngleRef.current) {
          driftAngleRef.current.textContent = `${angleDeg.toFixed(2)}°`;
        }
      } else {
        if (driftKmRef.current) driftKmRef.current.textContent = "—";
        if (driftAngleRef.current) driftAngleRef.current.textContent = "—";
      }
    };

    tick();
    const id = window.setInterval(tick, REFRESH_HZ_MS);
    return () => window.clearInterval(id);
  }, [
    store,
    isBodyActive,
    upperName,
    orbitingNameUpper,
    stateVectorRefNameUpper,
    activeProps,
    orbitingMu,
  ]);

  // Empty-space click in the scene dispatches setIsBodyActive(false) without
  // clearing activeBodyName (see Scene.tsx onPointerMissed). Gate on
  // isBodyActive too so the card returns to the empty state on deselect —
  // mirrors how BodySelector un-highlights pills via the same flag.
  if (!isBodyActive || !upperName || !activeProps) {
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
      <button
        type="button"
        onClick={() => dispatch(toggleInfoPanel())}
        aria-expanded={!infoCollapsed}
        aria-label={infoCollapsed ? "Expand body details" : "Collapse body details"}
        className={`flex w-full items-center gap-2.5 text-left ${
          infoCollapsed ? "" : "mb-2.5"
        }`}
      >
        {bodyKey && <BodyPortrait body={bodyKey} size={44} />}
        <div className="text-hi flex-1 text-[17px] font-semibold tracking-[-0.015em]">
          {display}
        </div>
        <CollapseChevron collapsed={infoCollapsed} />
      </button>

      {!infoCollapsed && (
        <>
          <div className="text-dim mb-1.5 text-[11px] leading-[1.55]">
            Tracking in {displayFrame === "geo" ? "geocentric" : "heliocentric"}{" "}
            frame.
          </div>

          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              State vector · J2000
              <InfoTooltip label="What is the state vector?">
                {STATE_VECTOR_COPY}
              </InfoTooltip>
            </span>
          </SectionLabel>
          <KvRow k={`Range to ${stateVectorRefDisplay}`} valueRef={rangeRef} />
          <KvRow k="Speed" valueRef={speedRef} accent />
          <KvRow k="r⃗ · x" valueRef={rxRef} />
          <KvRow k="r⃗ · y" valueRef={ryRef} />
          <KvRow k="v⃗ · ‖" valueRef={vmagRef} />

          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              Keplerian elements
              <InfoTooltip label="What are Keplerian elements?">
                {KEPLERIAN_COPY}
              </InfoTooltip>
            </span>
          </SectionLabel>
          <KvRow k="Semi-major axis · a" valueRef={semiMajorRef} />
          <KvRow k="Eccentricity · e" valueRef={eccentricityRef} />
          <KvRow k="Inclination · i" valueRef={inclinationRef} />
          <KvRow k="True anomaly · ν" valueRef={trueAnomalyRef} />
          <KvRow k="Period · T" valueRef={periodRef} />

          <SectionLabel>
            <span className="inline-flex items-center gap-1">
              Integrator residual
              <InfoTooltip label="What is the integrator residual?">
                {RESIDUAL_CONCEPT_COPY}
              </InfoTooltip>
            </span>
          </SectionLabel>
          <KvRow k="ΔE / E₀" valueRef={residualDeltaERef} />
          {dp853TelemetryActive && (
            <>
              <KvRow
                k={
                  <span className="inline-flex items-center gap-1">
                    Avg step
                    <InfoTooltip label="What is avg step?">
                      {AVG_STEP_COPY}
                    </InfoTooltip>
                  </span>
                }
                valueRef={avgStepRef}
              />
              <KvRow
                k={
                  <span className="inline-flex items-center gap-1">
                    Accept rate
                    <InfoTooltip label="What is accept rate?">
                      {ACCEPT_RATE_COPY}
                    </InfoTooltip>
                  </span>
                }
                valueRef={acceptRateRef}
              />
            </>
          )}
          {driftOverlayEnabled && (
            <>
              <SectionLabel>
                <span className="inline-flex items-center gap-1">
                  Reality drift
                  <InfoTooltip label="What is reality drift?">
                    {DRIFT_READOUT_COPY}
                  </InfoTooltip>
                </span>
              </SectionLabel>
              <KvRow k="Off by" valueRef={driftKmRef} accent />
              <KvRow k="Angle off" valueRef={driftAngleRef} />
            </>
          )}
        </>
      )}
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
  k: React.ReactNode;
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
