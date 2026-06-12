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
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import { writeBodyWorldPositionToArrayWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { worldDistance, worldRadius, worldDistanceFromParent } from "@/app/utils/scalePipeline";
import { getDevSettings } from "@/app/dev/devSettingsStore";
import { shouldShowMoonDetail } from "@/app/constants/BodyCatalog";

interface TrailProps {
  bodyName: string;
  color?: [number, number, number];
}

// Hard cap on trail buffer size. The dev-settings slider controls how
// many points are *drawn*; the buffer is allocated once at this max so
// dragging the slider doesn't reallocate or rebuild geometry on every
// step. 5000 × 6 floats × 4 bytes × ~9 trails ≈ 1 MB total — negligible.
const MAX_TRAIL_POINTS = 5000;

/**
 * Orbital trail rendered as a polyline. Reads the chunk buffer directly
 * from the Redux store inside useFrame (no React subscription) and mutates
 * a pre-allocated BufferGeometry in place.
 *
 * RGB-only (no alpha): fade-to-black on the dark scene background is
 * visually equivalent to alpha-fade and lets us use stock
 * LineBasicMaterial instead of a custom shader.
 */
const Trail: React.FC<TrailProps> = ({
  bodyName,
  color = [1, 1, 1],
}) => {
  const store = useStore<RootState>();
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  // Focus state for moon LOD gating. Subscribed (not read per-frame) so the
  // uppercase conversion happens once per selection change, not once per frame
  // — mirrors Camera.tsx / OrbitPath.tsx. activeBodyName isn't guaranteed
  // uppercase, so we hoist the conversion off the hot path rather than drop it.
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const activeBodyNameUpper = useMemo(
    () => activeBodyName?.toUpperCase() ?? null,
    [activeBodyName],
  );

  const { orbitingBodyNameUpper, ownRadiusM } = useMemo(() => {
    const nameUpper = bodyName.toUpperCase();
    const bodyProps: CelestialBodyProperties | undefined = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === nameUpper,
    );
    return {
      orbitingBodyNameUpper: bodyProps?.orbitingBody?.toUpperCase(),
      ownRadiusM: bodyProps?.radius ?? 0,
    };
  }, [bodyName, propsList]);

  const parentRadiusM = useMemo(() => {
    if (!orbitingBodyNameUpper) return 0;
    const parent = propsList?.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === orbitingBodyNameUpper,
    );
    return parent?.radius ?? 0;
  }, [orbitingBodyNameUpper, propsList]);

  const lineObject = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3),
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3),
    );
    geom.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({ vertexColors: true });
    const line = new THREE.Line(geom, mat);
    // We mutate position values in place each frame but never recompute
    // the bounding sphere, so three.js's frustum-culling check uses the
    // stale (zero-radius, origin-centered) sphere from when the buffer
    // was first allocated and culls the trail whenever the origin is
    // offscreen. Skip the culling check entirely — drawing 9 small
    // lines is cheap, the optimisation wasn't saving anything useful.
    line.frustumCulled = false;
    return line;
  }, []);

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      (lineObject.material as THREE.Material).dispose();
    };
  }, [lineObject]);

  // Reused scratch — never allocated per frame.
  const posScratchVec = useRef(new THREE.Vector3());
  const orbitingScratchVec = useRef(new THREE.Vector3());
  const posSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const orbitingSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const childDeltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  // Cached body indices into the chunk buffer. Backend's wire format
  // guarantees stable body ordering across every chunk of a session, so
  // we resolve once on the first valid buffer and skip per-iteration map
  // lookups thereafter.
  const bodyIndexRef = useRef<number>(-1);
  const orbitingIndexRef = useRef<number>(-1);
  // Buffer the cached indices were resolved against. A new simulation creates a
  // fresh ChunkBuffer whose body order depends on the selected set, so a reused
  // Trail (same bodyName, no remount) must re-resolve its slot or it reads the
  // wrong body's positions. Keyed on buffer identity, not bodyName, because the
  // name never changes for a reused component. Mirrors Camera.tsx.
  const resolvedBufferRef = useRef<object | null>(null);

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const currentTimeStepIndex =
      state.simulation.timeState.currentTimeStepIndex;
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    // Focus-gated moon LOD: skip this trail entirely when its moon system is
    // collapsed. Runs before the per-point loop, so collapsed moons cost a
    // couple of compares instead of the full trail walk. Planets (parent SUN)
    // and Earth's Moon are never gated. !isBodyActive means nothing is focused
    // (deselect leaves activeBodyName set) → null → gated systems collapse.
    const activeUpper = isBodyActive ? activeBodyNameUpper : null;
    if (!shouldShowMoonDetail(orbitingBodyNameUpper, activeUpper)) {
      lineObject.geometry.setDrawRange(0, 0);
      return;
    }

    const geom = lineObject.geometry;
    const positions = geom.attributes.position.array as Float32Array;
    const colors = geom.attributes.color.array as Float32Array;

    if (
      !buffer ||
      buffer.totalTimesteps === 0 ||
      currentTimeStepIndex < 1
    ) {
      geom.setDrawRange(0, 0);
      return;
    }

    const length = Math.min(MAX_TRAIL_POINTS, getDevSettings().trailLength);
    // Floor the current index for the tail loop. Trail renders *historical*
    // keyframes — integer indices semantically. Without this floor, every
    // iteration of the loop below would hit the chunkBuffer's Hermite path
    // (~30 mults/read) instead of the 4-read fast path. With ~5000 points × 9
    // trails × FPS, the difference is measurable.
    const idxFloor = Math.floor(currentTimeStepIndex);
    const start = Math.max(0, idxFloor - length);
    const end = Math.min(idxFloor, buffer.totalTimesteps - 1);
    const total = end - start;

    // Invalidate cached indices when the buffer changes (new simulation).
    if (resolvedBufferRef.current !== buffer) {
      bodyIndexRef.current = -1;
      orbitingIndexRef.current = -1;
      resolvedBufferRef.current = buffer;
    }

    // Lazy-resolve cached indices into the chunk buffer.
    if (bodyIndexRef.current === -1) {
      const targetUpper = bodyName.toUpperCase();
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === targetUpper) {
          bodyIndexRef.current = i;
          break;
        }
      }
      if (orbitingBodyNameUpper) {
        for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
          if (bn.toUpperCase() === orbitingBodyNameUpper) {
            orbitingIndexRef.current = i;
            break;
          }
        }
      }
    }
    const bodyIdx = bodyIndexRef.current;
    if (bodyIdx < 0) {
      geom.setDrawRange(0, 0);
      return;
    }
    const orbitingIdx = orbitingIndexRef.current;

    let count = 0;
    for (let i = start; i <= end; i++) {
      readBodyPositionInto(posScratchVec.current, buffer, i, bodyIdx);
      posSimple.current.x = posScratchVec.current.x;
      posSimple.current.y = posScratchVec.current.y;
      posSimple.current.z = posScratchVec.current.z;
      // Frame transform: subtract this timestep's pivot from `pos`. Geo
      // trails reproject per-history-point so the trail shows where the
      // body *was relative to Earth at each moment*, not relative to
      // Earth's current position. Helio path: pivot is zeros, the
      // subtraction is a no-op.
      writePivotInto(pivotScratch.current, buffer, i, displayFrame);
      posSimple.current.x -= pivotScratch.current.x;
      posSimple.current.y -= pivotScratch.current.y;
      posSimple.current.z -= pivotScratch.current.z;

      const writeIdx = count * 3;

      if (orbitingIdx >= 0) {
        // Body has a parent — apply the body-agnostic minimum-separation
        // rule via worldDistanceFromParent. Mirrors the Sphere.tsx pattern.
        readBodyPositionInto(orbitingScratchVec.current, buffer, i, orbitingIdx);
        orbitingSimple.current.x = orbitingScratchVec.current.x - pivotScratch.current.x;
        orbitingSimple.current.y = orbitingScratchVec.current.y - pivotScratch.current.y;
        orbitingSimple.current.z = orbitingScratchVec.current.z - pivotScratch.current.z;

        // Parent world position — inlined pipeline math (option b, no scratch alloc).
        // worldDistance maps |parent_m| to world units; scale each axis proportionally.
        const px = orbitingSimple.current.x;
        const py = orbitingSimple.current.y;
        const pz = orbitingSimple.current.z;
        const pr_m = Math.sqrt(px * px + py * py + pz * pz);
        const ps = pr_m === 0 ? 0 : worldDistance(pr_m, simulationScale.preset) / pr_m;
        // Y/Z swap: ICRF Y → world Z, ICRF Z → world Y.
        const parentWorldX = px * ps;
        const parentWorldY = pz * ps;
        const parentWorldZ = py * ps;

        // Child delta relative to parent — in ICRF axes (no swap yet).
        worldDistanceFromParent(
          posSimple.current,
          orbitingSimple.current,
          worldRadius(parentRadiusM, simulationScale.preset),
          worldRadius(ownRadiusM, simulationScale.preset),
          simulationScale.preset,
          childDeltaScratch.current,
          orbitingBodyNameUpper,
        );

        // Sum parent world pos + delta with Y/Z swap applied to delta.
        positions[writeIdx]     = parentWorldX + childDeltaScratch.current.x;
        positions[writeIdx + 1] = parentWorldY + childDeltaScratch.current.z; // swap
        positions[writeIdx + 2] = parentWorldZ + childDeltaScratch.current.y; // swap
      } else {
        writeBodyWorldPositionToArrayWithPreset(
          positions,
          writeIdx,
          posSimple.current,
          simulationScale.preset,
        );
      }

      const fade = total > 0 ? (i - start) / total : 1;
      colors[writeIdx] = color[0] * fade;
      colors[writeIdx + 1] = color[1] * fade;
      colors[writeIdx + 2] = color[2] * fade;

      count++;
    }

    geom.setDrawRange(0, count);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={lineObject} />;
};

export default Trail;
