"use client";

import { useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  selectSimulationScale,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import {
  readBodyPositionInto,
  readBodyStateInto,
} from "@/app/store/chunkBuffer";
import type { RootState } from "@/app/store/Store";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  subtractInto,
} from "@/app/utils/helpers";
import { worldRadius, worldDistanceFromParent } from "@/app/utils/scalePipeline";
import { BODY_DISPLAY, toBodyKey } from "@/app/constants/BodyVisuals";

// In-scene reticle on the active body — three concentric accent rings,
// N/E/S/W tick marks, leader line, and a label cluster offset to the
// upper-left. Position updates via group ref per frame; numerics update
// via DOM refs (gated by lastValue refs to skip identical writes).

function findBodyIndexCaseInsensitive(
  buffer: { bodyNameToIndex: ReadonlyMap<string, number> },
  nameUpper: string,
): number {
  for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
    if (bn.toUpperCase() === nameUpper) return i;
  }
  return -1;
}

export function Reticle() {
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const simulationScale = useSelector(selectSimulationScale);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  // Scratch (allocated once).
  const bodyPosVec = useRef(new THREE.Vector3());
  const bodyVelVec = useRef(new THREE.Vector3());
  const orbitingPosVec = useRef(new THREE.Vector3());
  const stateRefPosVec = useRef(new THREE.Vector3());
  const stateRefVelVec = useRef(new THREE.Vector3());
  const posSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const shiftedScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const velScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const parentWorldScratch = useRef(new THREE.Vector3());
  const childDeltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  // Cached slot indices for the focused body, its orbital parent, and the
  // frame-aware state reference. Reticle is an active-body component whose
  // indices depend on every input the lazy resolve reads: buffer identity,
  // the active body, the display frame (the state-reference target switches
  // to Earth in geo mode; see stateRefNameUpper below), and the parent name
  // derived from props. The guard keys on all four; keying on fewer would
  // serve a stale index when one of them changes alone. Mirrors
  // DriftOverlay's shape, plus the frame and parent keys.
  const bodyIdxRef = useRef<number>(-1);
  const orbitingIdxRef = useRef<number>(-1);
  const stateRefIdxRef = useRef<number>(-1);
  const resolvedBufferRef = useRef<object | null>(null);
  const resolvedBodyRef = useRef<string | null>(null);
  const resolvedFrameRef = useRef<string | null>(null);
  const resolvedOrbitingRef = useRef<string | null>(null);
  const lastRange = useRef<string>("");
  const lastVel = useRef<string>("");

  const upperName = activeBodyName?.trim().toUpperCase() ?? "";
  const activeProps: CelestialBodyProperties | undefined = upperName
    ? propsList?.find(
        (p: CelestialBodyProperties) =>
          p.name?.trim().toUpperCase() === upperName,
      )
    : undefined;
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";
  const ownRadiusM = activeProps?.radius ?? 0;
  const parentRadiusM = orbitingNameUpper
    ? (propsList?.find(
        (p: CelestialBodyProperties) =>
          p.name?.trim().toUpperCase() === orbitingNameUpper,
      )?.radius ?? 0)
    : 0;

  useFrame(() => {
    if (!isBodyActive || !upperName || !activeProps || !groupRef.current)
      return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    if (!buffer || idx >= buffer.totalTimesteps) return;

    const displayFrame = state.simulation.simulationParameters.displayFrame;

    // Invalidate cached indices when any resolution input changes: buffer
    // identity (new simulation), active body (focus switch), display frame
    // (the state reference switches to Earth in geo mode), or the derived
    // parent name.
    if (
      resolvedBufferRef.current !== buffer ||
      resolvedBodyRef.current !== upperName ||
      resolvedFrameRef.current !== displayFrame ||
      resolvedOrbitingRef.current !== orbitingNameUpper
    ) {
      bodyIdxRef.current = -1;
      orbitingIdxRef.current = -1;
      stateRefIdxRef.current = -1;
      resolvedBufferRef.current = buffer;
      resolvedBodyRef.current = upperName;
      resolvedFrameRef.current = displayFrame;
      resolvedOrbitingRef.current = orbitingNameUpper;
    }
    // Lazy-resolve: one set of map scans per (sim, focus, frame) change.
    if (bodyIdxRef.current === -1) {
      bodyIdxRef.current = findBodyIndexCaseInsensitive(buffer, upperName);
      // Orbital reference (orbitingNameUpper) feeds the scale-pipeline
      // parent/child branch below; the frame-aware state reference feeds
      // the range/velocity readouts.
      orbitingIdxRef.current = orbitingNameUpper
        ? findBodyIndexCaseInsensitive(buffer, orbitingNameUpper)
        : -1;
      const stateRefNameUpper =
        upperName === "MOON"
          ? "EARTH"
          : displayFrame === "geo"
            ? "EARTH"
            : orbitingNameUpper;
      stateRefIdxRef.current =
        stateRefNameUpper && stateRefNameUpper !== upperName
          ? findBodyIndexCaseInsensitive(buffer, stateRefNameUpper)
          : -1;
    }
    const bodyIdx = bodyIdxRef.current;
    if (bodyIdx < 0) return;
    const orbitingIdx = orbitingIdxRef.current;
    const stateRefIdx = stateRefIdxRef.current;

    readBodyStateInto(bodyPosVec.current, bodyVelVec.current, buffer, idx, bodyIdx);

    posSimple.current.x = bodyPosVec.current.x;
    posSimple.current.y = bodyPosVec.current.y;
    posSimple.current.z = bodyPosVec.current.z;

    // Apply display-frame pivot. Reticle marks the body in scene world
    // space, so it has to follow the same pivot subtraction Sphere.tsx
    // applies — otherwise in geo mode the reticle floats at the body's
    // heliocentric coordinate while the rendered body sits at its
    // geocentric one (1 AU mismatch).
    writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
    posSimple.current.x -= pivotScratch.current.x;
    posSimple.current.y -= pivotScratch.current.y;
    posSimple.current.z -= pivotScratch.current.z;

    if (orbitingNameUpper && orbitingIdx >= 0) {
      readBodyPositionInto(orbitingPosVec.current, buffer, idx, orbitingIdx);
      // shiftedScratch reused here for the parent's pivot-adjusted metres position.
      shiftedScratch.current.x = orbitingPosVec.current.x - pivotScratch.current.x;
      shiftedScratch.current.y = orbitingPosVec.current.y - pivotScratch.current.y;
      shiftedScratch.current.z = orbitingPosVec.current.z - pivotScratch.current.z;

      // Parent's world-unit position via the pipeline.
      setBodyWorldPositionWithPreset(
        parentWorldScratch.current,
        shiftedScratch.current,
        simulationScale.preset,
      );

      // Child world-relative-to-parent delta with min-separation rule.
      worldDistanceFromParent(
        posSimple.current,
        shiftedScratch.current,
        worldRadius(parentRadiusM, simulationScale.preset),
        worldRadius(ownRadiusM, simulationScale.preset),
        simulationScale.preset,
        childDeltaScratch.current,
        orbitingNameUpper,
      );

      // Y/Z swap on the delta to convert from ICRF axes to three.js world space.
      groupRef.current.position.set(
        parentWorldScratch.current.x + childDeltaScratch.current.x,
        parentWorldScratch.current.y + childDeltaScratch.current.z,
        parentWorldScratch.current.z + childDeltaScratch.current.y,
      );
    } else {
      setBodyWorldPositionWithPreset(
        groupRef.current.position,
        posSimple.current,
        simulationScale.preset,
      );
    }

    if (stateRefIdx < 0) {
      // No frame-aware state reference. Show dashes.
      if (rangeRef.current && lastRange.current !== "—") {
        rangeRef.current.textContent = "—";
        lastRange.current = "—";
      }
      if (velRef.current && lastVel.current !== "—") {
        velRef.current.textContent = "—";
        lastVel.current = "—";
      }
      return;
    }

    readBodyStateInto(
      stateRefPosVec.current,
      stateRefVelVec.current,
      buffer,
      idx,
      stateRefIdx,
    );

    // THREE.Vector3 is structurally a Vector3Simple (x/y/z fields); pass the
    // scratch vectors directly instead of copying into per-frame literals.
    const range = calculateDistance(
      bodyPosVec.current,
      stateRefPosVec.current,
      "AU",
    );
    if (range !== lastRange.current && rangeRef.current) {
      rangeRef.current.textContent = range;
      lastRange.current = range;
    }
    subtractInto(velScratch.current, bodyVelVec.current, stateRefVelVec.current);
    const vel = formatToKM(calculateMagnitude(velScratch.current));
    if (vel !== lastVel.current && velRef.current) {
      velRef.current.textContent = vel;
      lastVel.current = vel;
    }
  });

  // Reset cached values on body switch so first frame after switch writes
  // through unconditionally.
  useEffect(() => {
    lastRange.current = "";
    lastVel.current = "";
  }, [activeBodyName]);

  if (!upperName || !isBodyActive || !activeProps) return null;

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey ? BODY_DISPLAY[bodyKey].toUpperCase() : upperName;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <div className="relative">
          <svg
            width="160"
            height="160"
            style={{ position: "absolute", left: -80, top: -80 }}
          >
            <circle
              cx="80"
              cy="80"
              r="44"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.15"
            />
            <circle
              cx="80"
              cy="80"
              r="30"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.55"
            />
            {[0, 90, 180, 270].map((a) => (
              <g key={a} transform={`rotate(${a} 80 80)`}>
                <line
                  x1="80"
                  y1="32"
                  x2="80"
                  y2="40"
                  stroke="var(--color-accent)"
                  strokeWidth="1"
                  opacity="0.7"
                />
              </g>
            ))}
          </svg>

          <svg
            width="320"
            height="120"
            style={{ position: "absolute", left: -290, top: -90, overflow: "visible" }}
          >
            <path
              d="M 268 88 L 200 50 L 30 50"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.55"
            />
            <circle cx="268" cy="88" r="2.5" fill="var(--color-accent)" />
          </svg>

          <div
            className="absolute font-mono"
            style={{
              left: -260,
              top: -52,
              whiteSpace: "nowrap",
              letterSpacing: "0.10em",
            }}
          >
            <div className="text-accent text-[10px] font-semibold">
              {display}
            </div>
            <div className="text-dim mt-0.5 text-[9.5px]">
              Range <span ref={rangeRef}>—</span> · v{" "}
              <span ref={velRef}>—</span>
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}
