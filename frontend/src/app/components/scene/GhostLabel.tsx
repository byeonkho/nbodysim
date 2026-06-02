"use client";

import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectSimulationScale,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import type { RootState } from "@/app/store/Store";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { calculateDistance } from "@/app/utils/helpers";
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
  const frameCounter = useRef(0);
  const lastAu = useRef<string>("");

  const upperName = bodyName.trim().toUpperCase();
  const properties: CelestialBodyProperties | undefined = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    properties?.orbitingBody?.trim().toUpperCase() ?? "";
  const ownRadiusM = properties?.radius ?? 0;
  const parentRadiusM =
    propsList?.find(
      (p: CelestialBodyProperties) =>
        p.name?.trim().toUpperCase() === orbitingNameUpper,
    )?.radius ?? 0;

  useFrame(() => {
    if (!groupRef.current || !properties) return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    if (!buffer || idx >= buffer.totalTimesteps) return;

    let bodyIdx = -1;
    let orbitingIdx = -1;
    for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
      const bnUpper = bn.toUpperCase();
      if (bnUpper === upperName) bodyIdx = i;
      if (orbitingNameUpper && bnUpper === orbitingNameUpper) orbitingIdx = i;
      if (bodyIdx >= 0 && (orbitingIdx >= 0 || !orbitingNameUpper)) break;
    }
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

    frameCounter.current++;
    if (frameCounter.current >= TEXT_THROTTLE_FRAMES) {
      frameCounter.current = 0;
      if (orbitingIdx >= 0) {
        readBodyPositionInto(orbitingPosVec.current, buffer, idx, orbitingIdx);
        const bodySimple = {
          x: bodyPosVec.current.x,
          y: bodyPosVec.current.y,
          z: bodyPosVec.current.z,
        };
        const orbSimple = {
          x: orbitingPosVec.current.x,
          y: orbitingPosVec.current.y,
          z: orbitingPosVec.current.z,
        };
        const au = calculateDistance(bodySimple, orbSimple, "AU");
        if (au !== lastAu.current && auRef.current) {
          auRef.current.textContent = au;
          lastAu.current = au;
        }
      }
    }
  });

  if (!properties) return null;

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey ? BODY_DISPLAY[bodyKey] : bodyName;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }} center>
        <div
          className="text-center font-medium uppercase"
          style={{ transform: "translateY(-180%)", whiteSpace: "nowrap" }}
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
        </div>
      </Html>
    </group>
  );
}
