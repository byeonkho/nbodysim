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
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  scaleDistanceInto,
  subtractInto,
} from "@/app/utils/helpers";
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

  useFrame(() => {
    if (!isBodyActive || !upperName || !activeProps || !groupRef.current)
      return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    if (!buffer || idx >= buffer.totalTimesteps) return;

    const bodyIdx = findBodyIndexCaseInsensitive(buffer, upperName);
    if (bodyIdx < 0) return;

    const displayFrame = state.simulation.simulationParameters.displayFrame;

    readBodyStateInto(bodyPosVec.current, bodyVelVec.current, buffer, idx, bodyIdx);

    // Orbital reference (orbitingNameUpper) is used for the positionScale
    // visual fudge below. Frame-aware state-vector reference (computed
    // here) is used for the range/velocity readouts.
    const orbitingIdx = orbitingNameUpper
      ? findBodyIndexCaseInsensitive(buffer, orbitingNameUpper)
      : -1;

    const stateRefNameUpper =
      upperName === "MOON"
        ? "EARTH"
        : displayFrame === "geo"
          ? "EARTH"
          : orbitingNameUpper;
    const stateRefIdx =
      stateRefNameUpper && stateRefNameUpper !== upperName
        ? findBodyIndexCaseInsensitive(buffer, stateRefNameUpper)
        : -1;

    const positionScale = activeProps.positionScale ?? 1;
    posSimple.current.x = bodyPosVec.current.x;
    posSimple.current.y = bodyPosVec.current.y;
    posSimple.current.z = bodyPosVec.current.z;
    let pos: Vector3Simple = posSimple.current;
    if (positionScale !== 1 && orbitingIdx >= 0) {
      readBodyPositionInto(orbitingPosVec.current, buffer, idx, orbitingIdx);
      scaleDistanceInto(
        posSimple.current,
        posSimple.current,
        {
          x: orbitingPosVec.current.x,
          y: orbitingPosVec.current.y,
          z: orbitingPosVec.current.z,
        },
        positionScale,
      );
      pos = posSimple.current;
    }

    // Apply display-frame pivot. Reticle marks the body in scene world
    // space, so it has to follow the same pivot subtraction Sphere.tsx
    // applies — otherwise in geo mode the reticle floats at the body's
    // heliocentric coordinate while the rendered body sits at its
    // geocentric one (1 AU mismatch).
    writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
    shiftedScratch.current.x = pos.x - pivotScratch.current.x;
    shiftedScratch.current.y = pos.y - pivotScratch.current.y;
    shiftedScratch.current.z = pos.z - pivotScratch.current.z;
    pos = shiftedScratch.current;

    setBodyWorldPosition(
      groupRef.current.position,
      pos,
      simulationScale.positionScale,
    );

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

    const bodyPosSimple = {
      x: bodyPosVec.current.x,
      y: bodyPosVec.current.y,
      z: bodyPosVec.current.z,
    };
    const stateRefPosSimple = {
      x: stateRefPosVec.current.x,
      y: stateRefPosVec.current.y,
      z: stateRefPosVec.current.z,
    };
    const range = calculateDistance(bodyPosSimple, stateRefPosSimple, "AU");
    if (range !== lastRange.current && rangeRef.current) {
      rangeRef.current.textContent = range;
      lastRange.current = range;
    }
    subtractInto(
      velScratch.current,
      {
        x: bodyVelVec.current.x,
        y: bodyVelVec.current.y,
        z: bodyVelVec.current.z,
      },
      {
        x: stateRefVelVec.current.x,
        y: stateRefVelVec.current.y,
        z: stateRefVelVec.current.z,
      },
    );
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
