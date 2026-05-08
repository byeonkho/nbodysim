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
import { scaleDistanceInto } from "@/app/utils/helpers";

interface TrailProps {
  bodyName: string;
  length?: number;
  color?: [number, number, number];
}

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
  length = 300,
  color = [1, 1, 1],
}) => {
  const store = useStore<RootState>();

  // Built once per Trail instance, persists across frames. The Float32Arrays
  // backing the attributes are mutated in useFrame.
  const lineObject = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(length * 3), 3),
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(length * 3), 3),
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
  }, [length]);

  // <primitive object> doesn't auto-dispose user-managed objects.
  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      (lineObject.material as THREE.Material).dispose();
    };
  }, [lineObject]);

  // Reused across the K=300 inner-loop iterations to avoid allocating
  // a Vector3Simple for every moon-scale point per frame.
  const posScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

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

    let count = 0;
    for (let i = start; i <= end; i++) {
      const key = timeStepKeys[i];
      const snapshot = simulationData[key];
      if (!snapshot) continue;
      const body = snapshot.find((b: CelestialBody) => b.name === bodyName);
      if (!body) continue;

      let pos: Vector3Simple = body.position;
      if (positionScale !== 1 && orbitingBodyName) {
        const orbiting = snapshot.find(
          (b: CelestialBody) =>
            b.name.toUpperCase() === orbitingBodyName.toUpperCase(),
        );
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
      positions[idx] = pos.x / simulationScale.positionScale;
      positions[idx + 1] = pos.y / simulationScale.positionScale;
      positions[idx + 2] = pos.z / simulationScale.positionScale;

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
