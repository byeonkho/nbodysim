"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "react-redux";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectTimeStepKeys,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { writeBodyWorldPositionToArray } from "@/app/utils/coordinates";
import { scaleDistanceInto } from "@/app/utils/helpers";
import { getDevSettings } from "@/app/dev/devSettingsStore";

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
 * Orbital trail rendered as a polyline. Reads simulation state directly
 * from the Redux store inside useFrame (no React subscription) and mutates
 * a pre-allocated BufferGeometry in place. Avoids per-frame React
 * reconciliation, array allocation, and full GPU buffer rebuilds —
 * the previous drei <Line> rebuilt the geometry on every prop-ref change
 * (i.e. every frame), which compounded GC and GPU-driver pressure over
 * playback time and was the dominant cause of the linear FPS decay.
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

  // Allocated once per Trail instance at MAX_TRAIL_POINTS and reused
  // across frames. Float32Arrays mutated in useFrame; setDrawRange
  // controls how many points actually render.
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

  // <primitive object> doesn't auto-dispose user-managed objects.
  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      (lineObject.material as THREE.Material).dispose();
    };
  }, [lineObject]);

  // Reused across inner-loop iterations to avoid allocating a
  // Vector3Simple for every moon-scale point per frame.
  const posScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  // Cached snapshot indices for this body and its orbiting parent.
  // Backend's binary wire format guarantees stable body ordering across
  // every chunk of a session, so we resolve the index once on the first
  // valid snapshot and skip the per-iteration .find — at trailLength
  // 5000 × ~9 trails that's 45 000 .find calls + closure allocations
  // saved per frame (the dominant cost of the trail render path).
  const bodyIndexRef = useRef<number>(-1);
  const orbitingIndexRef = useRef<number>(-1);

  // Defensive reset on bodyName change. Trail components are keyed per
  // body in Scene.tsx, so the name is stable for an instance's lifetime
  // in practice — this guards future scene-graph changes.
  useEffect(() => {
    bodyIndexRef.current = -1;
    orbitingIndexRef.current = -1;
  }, [bodyName]);

  // Three.js BufferGeometry attribute arrays are mutated in place every frame
  // to avoid re-uploading the buffer. React 19's hook-immutability rule flags
  // this, but mutation is the canonical three.js pattern for dynamic geometry.
  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepIndex =
      state.simulation.timeState.currentTimeStepIndex;
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const celestialBodyPropertiesList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;
    const timeStepKeys = selectTimeStepKeys(state);

    const geom = lineObject.geometry;
    const positions = geom.attributes.position.array as Float32Array;
    const colors = geom.attributes.color.array as Float32Array;

    if (
      !simulationData ||
      timeStepKeys.length === 0 ||
      currentTimeStepIndex < 1
    ) {
      geom.setDrawRange(0, 0);
      return;
    }

    // Live tunable: dev-settings slider clamps to MAX_TRAIL_POINTS so
    // the buffer write loop never overruns the allocated geometry.
    const length = Math.min(MAX_TRAIL_POINTS, getDevSettings().trailLength);
    const start = Math.max(0, currentTimeStepIndex - length);
    const end = currentTimeStepIndex;
    const total = end - start;

    const bodyProps: CelestialBodyProperties | undefined =
      celestialBodyPropertiesList.find(
        (bp: CelestialBodyProperties) =>
          bp.name?.toUpperCase() === bodyName.toUpperCase(),
      );
    const positionScale = bodyProps?.positionScale ?? 1;
    const orbitingBodyName = bodyProps?.orbitingBody;

    // Lazy-resolve cached snapshot indices on the first valid snapshot.
    // Costs one full-snapshot scan per Trail; subsequent frames are
    // O(1) per iteration.
    if (bodyIndexRef.current === -1) {
      const probeKey = timeStepKeys[end];
      const probe = simulationData[probeKey];
      if (probe) {
        const target = bodyName.toUpperCase();
        for (let j = 0; j < probe.length; j++) {
          if (probe[j].name.toUpperCase() === target) {
            bodyIndexRef.current = j;
            break;
          }
        }
        if (orbitingBodyName) {
          const orbitingTarget = orbitingBodyName.toUpperCase();
          for (let j = 0; j < probe.length; j++) {
            if (probe[j].name.toUpperCase() === orbitingTarget) {
              orbitingIndexRef.current = j;
              break;
            }
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
      const key = timeStepKeys[i];
      const snapshot = simulationData[key];
      if (!snapshot) continue;
      const body = snapshot[bodyIdx];
      if (!body) continue;

      let pos: Vector3Simple = body.position;
      if (positionScale !== 1 && orbitingIdx >= 0) {
        const orbiting = snapshot[orbitingIdx];
        if (orbiting) {
          scaleDistanceInto(
            posScratch.current,
            body.position,
            orbiting.position,
            positionScale,
          );
          pos = posScratch.current;
        }
      }

      const idx = count * 3;
      writeBodyWorldPositionToArray(
        positions,
        idx,
        pos,
        simulationScale.positionScale,
      );

      // Fade older points toward black (visually equivalent to alpha fade
      // on the dark background — no custom shader needed).
      const fade = total > 0 ? (i - start) / total : 1;
      colors[idx] = color[0] * fade;
      colors[idx + 1] = color[1] * fade;
      colors[idx + 2] = color[2] * fade;

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
