"use client";

import { useRef, type RefObject } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectHoveredBodyName,
  selectSimulationScale,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto, readBodyStateInto } from "@/app/store/chunkBuffer";
import type { RootState } from "@/app/store/Store";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import {
  calculateDistance,
  calculateMagnitude,
  formatMassKg,
  formatOrbitalPeriod,
  formatRadiusKm,
  formatToKM,
  subtractInto,
} from "@/app/utils/helpers";
import { computeOrbitalElements } from "@/app/utils/orbitalElements";
import { worldRadius, worldDistanceFromParent } from "@/app/utils/scalePipeline";
import { BODY_DISPLAY, toBodyKey } from "@/app/constants/BodyVisuals";

// Two-line ghost label above each non-active body: NAME (uppercase, wide
// tracking) + AU sub. Position updates per frame; AU text updates every
// ~0.5s at 60fps to avoid pointless DOM thrashing on slow-moving outer
// planets.

const TEXT_THROTTLE_FRAMES = 30;

export function GhostLabel({
  bodyName,
  moonCount,
}: {
  bodyName: string;
  /** When set (collapsed moon-parent), render a "☾N" aggregate chip. */
  moonCount?: number;
}) {
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const simulationScale = useSelector(selectSimulationScale);
  const hoveredBodyName = useSelector(selectHoveredBodyName);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const auRef = useRef<HTMLDivElement>(null);
  const bodyPosVec = useRef(new THREE.Vector3());
  const orbitingPosVec = useRef(new THREE.Vector3());
  const posSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const orbitingSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const parentWorldScratch = useRef(new THREE.Vector3());
  const childDeltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  // Cached chunk-buffer slot indices, resolved once per buffer identity. A
  // new simulation creates a fresh ChunkBuffer whose body order depends on
  // the selected set, so a reused GhostLabel (same bodyName, no remount)
  // must re-resolve or it reads the wrong body's position. Mirrors Sphere.tsx.
  const bodyIdxRef = useRef<number>(-1);
  const orbitingIdxRef = useRef<number>(-1);
  const resolvedBufferRef = useRef<object | null>(null);
  const frameCounter = useRef(0);
  const lastAu = useRef<string>("");

  // Hover-expanded readout: the live Period / Speed values write to these
  // refs (Mass / Radius are static, rendered directly). Extra state scratch
  // is only touched on the throttled tick while this body is hovered.
  const speedRef = useRef<HTMLSpanElement>(null);
  const periodRef = useRef<HTMLSpanElement>(null);
  const wasHovered = useRef(false);
  const bodyStatePos = useRef(new THREE.Vector3());
  const bodyStateVel = useRef(new THREE.Vector3());
  const parStatePos = useRef(new THREE.Vector3());
  const parStateVel = useRef(new THREE.Vector3());
  const relVelScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  const upperName = bodyName.trim().toUpperCase();
  const isHovered = hoveredBodyName?.trim().toUpperCase() === upperName;
  const properties: CelestialBodyProperties | undefined = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    properties?.orbitingBody?.trim().toUpperCase() ?? "";
  const ownRadiusM = properties?.radius ?? 0;
  const parentProps: CelestialBodyProperties | undefined = orbitingNameUpper
    ? propsList?.find(
        (p: CelestialBodyProperties) =>
          p.name?.trim().toUpperCase() === orbitingNameUpper,
      )
    : undefined;
  const parentRadiusM = parentProps?.radius ?? 0;
  const parentMu = parentProps?.mu ?? 0;

  useFrame(() => {
    if (!groupRef.current || !properties) return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    if (!buffer || idx >= buffer.totalTimesteps) return;

    // Invalidate cached indices when the buffer changes (new simulation).
    if (resolvedBufferRef.current !== buffer) {
      bodyIdxRef.current = -1;
      orbitingIdxRef.current = -1;
      resolvedBufferRef.current = buffer;
    }
    // Lazy-resolve: one map pass per simulation, O(1) reads per frame after.
    if (bodyIdxRef.current === -1) {
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        const bnUpper = bn.toUpperCase();
        if (bnUpper === upperName) bodyIdxRef.current = i;
        if (orbitingNameUpper && bnUpper === orbitingNameUpper)
          orbitingIdxRef.current = i;
        if (
          bodyIdxRef.current >= 0 &&
          (orbitingIdxRef.current >= 0 || !orbitingNameUpper)
        )
          break;
      }
    }
    const bodyIdx = bodyIdxRef.current;
    const orbitingIdx = orbitingIdxRef.current;
    if (bodyIdx < 0) return;

    readBodyPositionInto(bodyPosVec.current, buffer, idx, bodyIdx);
    posSimple.current.x = bodyPosVec.current.x;
    posSimple.current.y = bodyPosVec.current.y;
    posSimple.current.z = bodyPosVec.current.z;
    const displayFrame = state.simulation.simulationParameters.displayFrame;
    const preset = simulationScale.preset;

    writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
    posSimple.current.x -= pivotScratch.current.x;
    posSimple.current.y -= pivotScratch.current.y;
    posSimple.current.z -= pivotScratch.current.z;

    if (orbitingNameUpper && orbitingIdx >= 0) {
      readBodyPositionInto(orbitingPosVec.current, buffer, idx, orbitingIdx);
      orbitingSimple.current.x =
        orbitingPosVec.current.x - pivotScratch.current.x;
      orbitingSimple.current.y =
        orbitingPosVec.current.y - pivotScratch.current.y;
      orbitingSimple.current.z =
        orbitingPosVec.current.z - pivotScratch.current.z;

      setBodyWorldPositionWithPreset(
        parentWorldScratch.current,
        orbitingSimple.current,
        preset,
      );

      worldDistanceFromParent(
        posSimple.current,
        orbitingSimple.current,
        worldRadius(parentRadiusM, preset),
        worldRadius(ownRadiusM, preset),
        preset,
        childDeltaScratch.current,
        orbitingNameUpper,
      );

      groupRef.current.position.set(
        parentWorldScratch.current.x + childDeltaScratch.current.x,
        parentWorldScratch.current.y + childDeltaScratch.current.z,
        parentWorldScratch.current.z + childDeltaScratch.current.y,
      );
    } else {
      setBodyWorldPositionWithPreset(
        groupRef.current.position,
        posSimple.current,
        preset,
      );
    }

    // When hover turns on, force the throttled block to run this frame so the
    // expanded label populates immediately instead of after up to ~0.5s.
    if (isHovered && !wasHovered.current) {
      frameCounter.current = TEXT_THROTTLE_FRAMES;
    }
    wasHovered.current = isHovered;

    frameCounter.current++;
    if (frameCounter.current >= TEXT_THROTTLE_FRAMES) {
      frameCounter.current = 0;
      if (orbitingIdx >= 0) {
        readBodyPositionInto(orbitingPosVec.current, buffer, idx, orbitingIdx);
        // THREE.Vector3 is structurally a Vector3Simple (x/y/z fields); pass
        // the scratch vectors directly instead of copying into per-call
        // literals. Mirrors Reticle.tsx.
        const au = calculateDistance(
          bodyPosVec.current,
          orbitingPosVec.current,
          "AU",
        );
        if (au !== lastAu.current && auRef.current) {
          auRef.current.textContent = au;
          lastAu.current = au;
        }

        // Live Speed + Period for the hovered body only. Reads full state
        // (position + velocity) for body and parent from the raw buffer;
        // orbital elements are frame-invariant, so no pivot adjustment. One
        // body, throttled to ~2 Hz, so the computeOrbitalElements alloc is
        // negligible (matches the BodyCard 5 Hz readout pattern).
        if (isHovered) {
          readBodyStateInto(
            bodyStatePos.current,
            bodyStateVel.current,
            buffer,
            idx,
            bodyIdx,
          );
          readBodyStateInto(
            parStatePos.current,
            parStateVel.current,
            buffer,
            idx,
            orbitingIdx,
          );
          subtractInto(
            relVelScratch.current,
            bodyStateVel.current,
            parStateVel.current,
          );
          if (speedRef.current) {
            speedRef.current.textContent = formatToKM(
              calculateMagnitude(relVelScratch.current),
            );
          }
          if (periodRef.current) {
            const elements =
              parentMu > 0
                ? computeOrbitalElements(
                    bodyStatePos.current,
                    bodyStateVel.current,
                    parStatePos.current,
                    parStateVel.current,
                    parentMu,
                  )
                : null;
            periodRef.current.textContent = elements
              ? formatOrbitalPeriod(elements.period)
              : "—";
          }
        }
      }
    }
  });

  if (!properties) return null;

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey ? BODY_DISPLAY[bodyKey] : bodyName;

  return (
    <group ref={groupRef}>
      {/* Bottom-anchored: the label's bottom edge sits a fixed 34px above the
          body and the block grows upward. drei's `center` is intentionally
          omitted — it centers vertically too, which made the offset scale with
          the label's height, so the hover-expanded label leapt upward and left
          a gap below. translate(-50%, calc(-100% - 34px)) keeps the bottom
          pinned regardless of how many rows are shown. */}
      <Html style={{ pointerEvents: "none" }}>
        <div
          className="text-center font-medium uppercase"
          style={{
            transform: "translate(-50%, calc(-100% - 34px))",
            whiteSpace: "nowrap",
          }}
        >
          <div
            className="text-[9.5px]"
            style={{
              color: "rgba(220,221,227,0.50)",
              letterSpacing: "0.20em",
            }}
          >
            {display}
          </div>
          <div
            ref={auRef}
            className="tabular mt-0.5 font-mono text-[8.5px]"
            style={{ color: "rgba(220,221,227,0.32)" }}
          />
          {moonCount != null && moonCount > 0 && (
            <div
              className="mt-0.5 font-mono text-[8.5px] normal-case"
              style={{ color: "rgba(220,221,227,0.40)", letterSpacing: "0.05em" }}
            >
              {`☾ ${moonCount} ${moonCount === 1 ? "moon" : "moons"}`}
            </div>
          )}
          {isHovered && (
            <div
              className="mx-auto mt-1.5 w-max text-left normal-case"
              style={{
                color: "rgba(220,221,227,0.55)",
                fontSize: "8px",
                lineHeight: 1.55,
              }}
            >
              <StatRow label="Mass" value={formatMassKg(properties.mass)} />
              <StatRow label="Radius" value={formatRadiusKm(ownRadiusM)} />
              {orbitingNameUpper && (
                <>
                  <StatRow label="Period" valueRef={periodRef} />
                  <StatRow label="Speed" valueRef={speedRef} />
                </>
              )}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// One key/value row in the hover-expanded readout. Static facts pass `value`;
// live facts (Period, Speed) pass `valueRef` and are written imperatively
// from useFrame so they update without re-rendering the label.
function StatRow({
  label,
  value,
  valueRef,
}: {
  label: string;
  value?: string;
  valueRef?: RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="flex justify-between gap-3 font-mono">
      <span style={{ opacity: 0.6 }}>{label}</span>
      {value !== undefined ? (
        <span className="tabular">{value}</span>
      ) : (
        <span ref={valueRef} className="tabular" />
      )}
    </div>
  );
}
