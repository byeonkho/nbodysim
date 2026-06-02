"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import {
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyStateInto } from "@/app/store/chunkBuffer";
import { writePivotInto } from "@/app/utils/framePivot";
import {
  makeOrbitScratch,
  type OrbitScratch,
  writeOsculatingEllipsePoints,
} from "@/app/utils/osculatingOrbit";
import {
  worldDistance,
  worldDistanceFromParent,
  worldRadius,
} from "@/app/utils/scalePipeline";
import { shouldShowMoonDetail } from "@/app/constants/BodyCatalog";

interface OrbitPathProps {
  bodyName: string;
  color?: [number, number, number];
}

const ORBIT_SEGMENTS = 96;
const ORBIT_BRIGHTNESS = 0.35;

/**
 * Osculating Keplerian orbit rendered as a closed polyline (LineLoop).
 *
 * Distinct from <Trail/>: the trail is time-domain (where the body has
 * been); the orbit is geometry-domain (the ellipse the body would trace
 * forever if all other bodies' gravity vanished right now). Recomputed
 * each render frame from the latest state vector + parent's µ — small
 * N-body perturbations in the sim cause the ellipse to slowly osculate
 * frame-to-frame.
 */
const OrbitPath: React.FC<OrbitPathProps> = ({
  bodyName,
  color = [1, 1, 1],
}) => {
  const store = useStore<RootState>();
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  // Focus state for moon LOD gating. Subscribed (not read per-frame) so the
  // uppercase conversion happens once per selection change, not once per
  // frame — mirrors Camera.tsx. activeBodyName isn't guaranteed uppercase, so
  // we can't drop the conversion, but we can hoist it off the hot path.
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const activeBodyNameUpper = useMemo(
    () => activeBodyName?.toUpperCase() ?? null,
    [activeBodyName],
  );

  const { ownRadiusM, parentBodyName } = useMemo(() => {
    const nameUpper = bodyName.toUpperCase();
    const bp = propsList?.find(
      (p: CelestialBodyProperties) => p.name?.toUpperCase() === nameUpper,
    );
    return {
      ownRadiusM: bp?.radius ?? 0,
      parentBodyName: bp?.orbitingBody?.toUpperCase(),
    };
  }, [bodyName, propsList]);

  const parentRadiusM = useMemo(() => {
    if (!parentBodyName) return 0;
    const p = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === parentBodyName,
    );
    return p?.radius ?? 0;
  }, [parentBodyName, propsList]);

  const lineObject = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(ORBIT_SEGMENTS * 3), 3),
    );
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(
        color[0] * ORBIT_BRIGHTNESS,
        color[1] * ORBIT_BRIGHTNESS,
        color[2] * ORBIT_BRIGHTNESS,
      ),
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.LineLoop(geom, mat);
    line.frustumCulled = false;
    line.visible = false;
    return line;
  }, [color]);

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      (lineObject.material as THREE.Material).dispose();
    };
  }, [lineObject]);

  // Cached chunk-buffer indices and parent µ — resolved once on first
  // valid buffer, O(1) per frame thereafter.
  const bodyIndexRef = useRef<number>(-1);
  const parentIndexRef = useRef<number>(-1);
  const muRef = useRef<number>(0);

  const orbitScratch = useRef<OrbitScratch>(makeOrbitScratch());
  const ellipseLocal = useRef<Float32Array>(
    new Float32Array(ORBIT_SEGMENTS * 3),
  );
  const bodyPosVec = useRef(new THREE.Vector3());
  const bodyVelVec = useRef(new THREE.Vector3());
  const parentPosVec = useRef(new THREE.Vector3());
  const parentVelVec = useRef(new THREE.Vector3());
  const rRel = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const vRel = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivot = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const parentMetresScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const vertexMetresScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const deltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    bodyIndexRef.current = -1;
    parentIndexRef.current = -1;
    muRef.current = 0;
  }, [bodyName]);

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();

    // Focus-gated moon LOD: hide this orbit when it belongs to a collapsed
    // moon system. Runs before the per-segment ellipse math, so collapsed
    // moons cost almost nothing. Planets (parent SUN) and Earth's Moon are
    // never gated. !isBodyActive means nothing is focused (deselect leaves
    // activeBodyName set) → null → every gated system collapses.
    const activeUpper = isBodyActive ? activeBodyNameUpper : null;
    if (!shouldShowMoonDetail(parentBodyName, activeUpper)) {
      lineObject.visible = false;
      return;
    }

    const buffer = state.simulation.chunkBuffer;
    const currentTimeStepIndex =
      state.simulation.timeState.currentTimeStepIndex;
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const propsList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    if (!buffer || buffer.totalTimesteps === 0) {
      lineObject.visible = false;
      return;
    }
    if (currentTimeStepIndex < 0 || currentTimeStepIndex >= buffer.totalTimesteps) {
      lineObject.visible = false;
      return;
    }

    // Lazy-resolve body / parent indices and parent µ on the first valid
    // buffer. One-shot scan; frames thereafter are O(1) lookups.
    if (bodyIndexRef.current === -1) {
      const target = bodyName.toUpperCase();
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === target) {
          bodyIndexRef.current = i;
          break;
        }
      }
      if (bodyIndexRef.current === -1) {
        lineObject.visible = false;
        return;
      }

      const bodyProps = propsList.find(
        (p: CelestialBodyProperties) => p.name?.toUpperCase() === target,
      );
      const parentName = (bodyProps?.orbitingBody ?? "SUN")
        .trim()
        .toUpperCase();
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === parentName) {
          parentIndexRef.current = i;
          break;
        }
      }

      const parentProps = propsList.find(
        (p: CelestialBodyProperties) =>
          p.name?.toUpperCase() === parentName,
      );
      muRef.current = parentProps?.mu ?? 0;
    }

    if (parentIndexRef.current < 0 || muRef.current <= 0) {
      lineObject.visible = false;
      return;
    }

    readBodyStateInto(
      bodyPosVec.current,
      bodyVelVec.current,
      buffer,
      currentTimeStepIndex,
      bodyIndexRef.current,
    );
    readBodyStateInto(
      parentPosVec.current,
      parentVelVec.current,
      buffer,
      currentTimeStepIndex,
      parentIndexRef.current,
    );

    rRel.current.x = bodyPosVec.current.x - parentPosVec.current.x;
    rRel.current.y = bodyPosVec.current.y - parentPosVec.current.y;
    rRel.current.z = bodyPosVec.current.z - parentPosVec.current.z;
    vRel.current.x = bodyVelVec.current.x - parentVelVec.current.x;
    vRel.current.y = bodyVelVec.current.y - parentVelVec.current.y;
    vRel.current.z = bodyVelVec.current.z - parentVelVec.current.z;

    const ok = writeOsculatingEllipsePoints(
      ellipseLocal.current,
      ORBIT_SEGMENTS,
      rRel.current,
      vRel.current,
      muRef.current,
      orbitScratch.current,
    );
    if (!ok) {
      lineObject.visible = false;
      return;
    }

    writePivotInto(pivot.current, buffer, currentTimeStepIndex, displayFrame);

    const positions = (
      lineObject.geometry.attributes.position as THREE.BufferAttribute
    ).array as Float32Array;
    const px = parentPosVec.current.x;
    const py = parentPosVec.current.y;
    const pz = parentPosVec.current.z;
    const pivX = pivot.current.x;
    const pivY = pivot.current.y;
    const pivZ = pivot.current.z;
    // Parent's pivot-subtracted metres position (shared across every vertex).
    parentMetresScratch.current.x = px - pivX;
    parentMetresScratch.current.y = py - pivY;
    parentMetresScratch.current.z = pz - pivZ;

    // Parent's world-unit position via the pipeline (Y/Z swap applied).
    const parentR_m = Math.sqrt(
      parentMetresScratch.current.x * parentMetresScratch.current.x +
        parentMetresScratch.current.y * parentMetresScratch.current.y +
        parentMetresScratch.current.z * parentMetresScratch.current.z,
    );
    const parentLinearScale =
      parentR_m === 0
        ? 0
        : worldDistance(parentR_m, simulationScale.preset) / parentR_m;
    const parentWX = parentMetresScratch.current.x * parentLinearScale;
    const parentWY_threejs = parentMetresScratch.current.z * parentLinearScale; // Y/Z swap
    const parentWZ_threejs = parentMetresScratch.current.y * parentLinearScale;

    const parentR_wu = worldRadius(parentRadiusM, simulationScale.preset);
    const ownR_wu = worldRadius(ownRadiusM, simulationScale.preset);
    const preset = simulationScale.preset;

    // Local ellipse (parent-relative) → heliocentric (add parent metres) →
    // frame (subtract pivot) → world via worldDistanceFromParent with the same
    // min-separation rule as the body, so the orbit sits where the body renders.
    for (let i = 0; i < ORBIT_SEGMENTS; i++) {
      const idx = i * 3;
      const lx = ellipseLocal.current[idx];
      const ly = ellipseLocal.current[idx + 1];
      const lz = ellipseLocal.current[idx + 2];

      // Vertex's absolute pivot-subtracted metres position.
      vertexMetresScratch.current.x = lx + parentMetresScratch.current.x;
      vertexMetresScratch.current.y = ly + parentMetresScratch.current.y;
      vertexMetresScratch.current.z = lz + parentMetresScratch.current.z;

      // Parent-relative world delta with min-separation rule applied.
      worldDistanceFromParent(
        vertexMetresScratch.current,
        parentMetresScratch.current,
        parentR_wu,
        ownR_wu,
        preset,
        deltaScratch.current,
        parentBodyName,
      );

      // Sum parent world + delta. Delta is in ICRF axes — apply Y/Z swap
      // to delta before summing so both terms are in three.js world space.
      // ICRF (X, Y, Z) → three.js (X, Z, Y) — same swap as coordinates.ts.
      positions[idx] = parentWX + deltaScratch.current.x;
      positions[idx + 1] = parentWY_threejs + deltaScratch.current.z; // swap
      positions[idx + 2] = parentWZ_threejs + deltaScratch.current.y;
    }

    lineObject.geometry.attributes.position.needsUpdate = true;
    lineObject.visible = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={lineObject} />;
};

export default OrbitPath;
