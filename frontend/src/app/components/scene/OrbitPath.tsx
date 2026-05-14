"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useStore } from "react-redux";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import {
  CelestialBodyProperties,
  selectTimeStepKeys,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { findEarthIndex, writePivotInto } from "@/app/utils/framePivot";
import {
  makeOrbitScratch,
  type OrbitScratch,
  writeOsculatingEllipsePoints,
} from "@/app/utils/osculatingOrbit";

interface OrbitPathProps {
  bodyName: string;
  color?: [number, number, number];
}

// Vertices around the closed ellipse. 96 reads as a continuous curve at
// any reasonable zoom — even Neptune's apoapsis-side curvature has no
// visible polygonal facets. Cost is trivial (~96 sin/cos per body per
// sim tick; see osculatingOrbit.ts header).
const ORBIT_SEGMENTS = 96;

// Brightness multiplier on the body's full color. 0.35 sits the orbit
// visually behind the trail (which fades from full body color) without
// disappearing — both layers stay legible when overlapping.
const ORBIT_BRIGHTNESS = 0.35;

/**
 * Osculating Keplerian orbit rendered as a closed polyline (LineLoop).
 *
 * Distinct from <Trail/>: the trail is time-domain (where the body has
 * been); the orbit is geometry-domain (the ellipse the body would trace
 * forever if all other bodies' gravity vanished right now). Recomputed
 * each render frame from the latest state vector + parent's µ — small
 * N-body perturbations in the sim cause the ellipse to slowly osculate
 * frame-to-frame, which is the visualisation's "instantaneous Keplerian
 * approximation" semantics.
 *
 * Hot-path conventions per frontend-render-loop rules: pre-allocated
 * BufferGeometry mutated in place inside useFrame; imperative store reads
 * (no per-frame React subscriptions); body / parent indices cached lazily.
 */
const OrbitPath: React.FC<OrbitPathProps> = ({
  bodyName,
  color = [1, 1, 1],
}) => {
  const store = useStore<RootState>();

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
    // LineLoop closes the polyline back to the first vertex — no need to
    // duplicate vertex 0 at index N.
    const line = new THREE.LineLoop(geom, mat);
    // Same reasoning as Trail.tsx: bounds aren't recomputed after per-frame
    // mutation, so the stale origin-centered zero-radius sphere causes
    // frustum culling to drop the orbit at certain camera angles.
    line.frustumCulled = false;
    line.visible = false; // hidden until first valid compute
    return line;
  }, [color]);

  useEffect(() => {
    return () => {
      lineObject.geometry.dispose();
      (lineObject.material as THREE.Material).dispose();
    };
  }, [lineObject]);

  // Cached snapshot indices and parent µ — resolved once on the first
  // valid snapshot, O(1) per frame thereafter. Mirrors Trail.tsx's caching
  // pattern (per the perf bug noted in frontend-render-loop.md).
  const bodyIndexRef = useRef<number>(-1);
  const parentIndexRef = useRef<number>(-1);
  const earthIndexRef = useRef<number>(-1);
  const muRef = useRef<number>(0);

  // Pre-allocated scratches, reused per-frame. Float32Array sized for the
  // parent-relative ellipse points (ICRF metres); Vector3Simple refs for
  // the per-tick relative-state computation and frame pivot.
  const orbitScratch = useRef<OrbitScratch>(makeOrbitScratch());
  const ellipseLocal = useRef<Float32Array>(
    new Float32Array(ORBIT_SEGMENTS * 3),
  );
  const rRel = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const vRel = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivot = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  // Defensive reset on bodyName change (Scene.tsx keys each OrbitPath per
  // body so this is unreachable in practice — guards future scene-graph
  // refactors).
  useEffect(() => {
    bodyIndexRef.current = -1;
    parentIndexRef.current = -1;
    earthIndexRef.current = -1;
    muRef.current = 0;
  }, [bodyName]);

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepIndex =
      state.simulation.timeState.currentTimeStepIndex;
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const propsList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;
    const displayFrame = state.simulation.simulationParameters.displayFrame;
    const timeStepKeys = selectTimeStepKeys(state);

    if (!simulationData || timeStepKeys.length === 0) {
      lineObject.visible = false;
      return;
    }

    const key = timeStepKeys[currentTimeStepIndex];
    const snapshot = simulationData[key];
    if (!snapshot) {
      lineObject.visible = false;
      return;
    }

    // Lazy-resolve body / parent indices and parent µ on the first valid
    // snapshot. One-shot O(N) scan; frames thereafter are O(1) lookups.
    if (bodyIndexRef.current === -1) {
      const target = bodyName.toUpperCase();
      for (let j = 0; j < snapshot.length; j++) {
        if (snapshot[j].name.toUpperCase() === target) {
          bodyIndexRef.current = j;
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
      // Default parent: Sun. Moons / satellites override via orbitingBody;
      // the snapshot is Sun-relative so we need (body − parent) state vectors
      // for the ellipse computation regardless.
      const parentName = (bodyProps?.orbitingBody ?? "SUN")
        .trim()
        .toUpperCase();
      for (let j = 0; j < snapshot.length; j++) {
        if (snapshot[j].name.toUpperCase() === parentName) {
          parentIndexRef.current = j;
          break;
        }
      }

      const parentProps = propsList.find(
        (p: CelestialBodyProperties) =>
          p.name?.toUpperCase() === parentName,
      );
      muRef.current = parentProps?.mu ?? 0;

      earthIndexRef.current = findEarthIndex(snapshot);
    }

    if (parentIndexRef.current < 0 || muRef.current <= 0) {
      // Parent not in snapshot, or µ not yet populated (first chunk hasn't
      // merged the µ map). Render nothing this frame; resolve next tick.
      lineObject.visible = false;
      return;
    }

    const body = snapshot[bodyIndexRef.current];
    const parent = snapshot[parentIndexRef.current];
    if (!body || !parent) {
      lineObject.visible = false;
      return;
    }

    // Parent-relative state vector. For Sun-orbiting bodies the parent is
    // the Sun (position ≈ 0, velocity ≈ 0 in the heliocentric snapshot
    // frame), so this is essentially a no-op subtraction; for the Moon
    // around Earth, the subtraction matters.
    rRel.current.x = body.position.x - parent.position.x;
    rRel.current.y = body.position.y - parent.position.y;
    rRel.current.z = body.position.z - parent.position.z;
    vRel.current.x = body.velocity.x - parent.velocity.x;
    vRel.current.y = body.velocity.y - parent.velocity.y;
    vRel.current.z = body.velocity.z - parent.velocity.z;

    const ok = writeOsculatingEllipsePoints(
      ellipseLocal.current,
      ORBIT_SEGMENTS,
      rRel.current,
      vRel.current,
      muRef.current,
      orbitScratch.current,
    );
    if (!ok) {
      // Unbound / degenerate trajectory — no closed orbit to draw.
      lineObject.visible = false;
      return;
    }

    writePivotInto(
      pivot.current,
      snapshot,
      displayFrame,
      earthIndexRef.current,
    );

    const positions = (
      lineObject.geometry.attributes.position as THREE.BufferAttribute
    ).array as Float32Array;
    const px = parent.position.x;
    const py = parent.position.y;
    const pz = parent.position.z;
    const pivX = pivot.current.x;
    const pivY = pivot.current.y;
    const pivZ = pivot.current.z;
    const scale = simulationScale.positionScale;

    // Local ellipse (parent-relative) → heliocentric (add parent position) →
    // frame (subtract pivot) → world (axis swap + positionScale division).
    // Inlined rather than calling writeBodyWorldPositionToArray per point —
    // the loop runs ORBIT_SEGMENTS × bodies times per frame and a function-
    // call per iteration would dominate the math.
    for (let i = 0; i < ORBIT_SEGMENTS; i++) {
      const idx = i * 3;
      const lx = ellipseLocal.current[idx];
      const ly = ellipseLocal.current[idx + 1];
      const lz = ellipseLocal.current[idx + 2];
      const wx = (lx + px - pivX) / scale;
      const wy = (ly + py - pivY) / scale;
      const wz = (lz + pz - pivZ) / scale;
      // ICRF (X, Y, Z) → three.js (X, Z, Y) — same swap as coordinates.ts.
      positions[idx] = wx;
      positions[idx + 1] = wz;
      positions[idx + 2] = wy;
    }

    lineObject.geometry.attributes.position.needsUpdate = true;
    lineObject.visible = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={lineObject} />;
};

export default OrbitPath;
