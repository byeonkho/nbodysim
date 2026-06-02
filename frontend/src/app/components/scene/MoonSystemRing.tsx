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
import { readBodyPositionInto, type ChunkBuffer } from "@/app/store/chunkBuffer";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { worldRadius, worldDistanceFromParent } from "@/app/utils/scalePipeline";
import { isMoonParentCollapsed } from "@/app/constants/BodyCatalog";

interface MoonSystemRingProps {
  /** Uppercased parent body name (e.g. "JUPITER"). */
  parentName: string;
  color?: [number, number, number];
}

const RING_SEGMENTS = 96;
const RING_BRIGHTNESS = 0.2; // dimmer than a real orbit (0.35), reads subordinate

/**
 * One faint circle at a moon system's extent, drawn on the parent only while
 * that system is collapsed (no member focused). It signals "a populated moon
 * system lives here" at scales where the individual moons are sub-pixel, and
 * disappears when the system is revealed (replaced by the real moon orbits).
 *
 * Radius tracks the outermost in-sim moon's rendered distance via the same
 * worldDistanceFromParent mapping the moons use, so it lands exactly at the
 * outermost moon under any scale preset / dev tuning. Recomputed per frame:
 * it's a handful of cheap reads (<=7 moons), and recomputing avoids the
 * staleness a cached radius would suffer when the scale preset / dev sliders
 * change. Only runs while collapsed, so focused systems pay nothing.
 */
const MoonSystemRing: React.FC<MoonSystemRingProps> = ({
  parentName,
  color = [0.7, 0.7, 0.7],
}) => {
  const store = useStore<RootState>();
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const parentUpper = parentName.toUpperCase();

  // Focus state for collapse gating. Subscribed (not read per-frame) so the
  // uppercase conversion happens once per selection change — mirrors
  // OrbitPath.tsx / Camera.tsx.
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const activeBodyNameUpper = useMemo(
    () => activeBodyName?.toUpperCase() ?? null,
    [activeBodyName],
  );

  // This parent's in-sim moons (name + radius) and the parent's own radius.
  const { parentRadiusM, moons } = useMemo(() => {
    const parent = propsList?.find(
      (p: CelestialBodyProperties) => p.name?.toUpperCase() === parentUpper,
    );
    const moonList =
      propsList
        ?.filter(
          (p: CelestialBodyProperties) =>
            p.orbitingBody?.trim().toUpperCase() === parentUpper,
        )
        .map((p: CelestialBodyProperties) => ({
          nameUpper: (p.name ?? "").toUpperCase(),
          radiusM: p.radius ?? 0,
        })) ?? [];
    return { parentRadiusM: parent?.radius ?? 0, moons: moonList };
  }, [propsList, parentUpper]);

  // Unit circle in the XZ plane, built once. Scaled + positioned per frame.
  const lineObject = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(RING_SEGMENTS * 3);
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      positions[i * 3] = Math.cos(a);
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a);
    }
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(
        color[0] * RING_BRIGHTNESS,
        color[1] * RING_BRIGHTNESS,
        color[2] * RING_BRIGHTNESS,
      ),
      transparent: true,
      opacity: 0.45,
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

  // Cached buffer indices (parent + each moon), invalidated on buffer identity.
  const parentIdxRef = useRef<number>(-1);
  const moonIdxRef = useRef<number[]>([]);
  const resolvedBufferRef = useRef<ChunkBuffer | null>(null);

  // Reused scratch — never allocated per frame.
  const parentReadVec = useRef(new THREE.Vector3());
  const moonReadVec = useRef(new THREE.Vector3());
  const parentSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const moonSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivot = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const deltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();

    // Visibility: only while this system is collapsed AND orbits are enabled.
    const activeUpper = isBodyActive ? activeBodyNameUpper : null;
    const showOrbitPaths =
      state.simulation.simulationParameters.showOrbitPaths;
    if (
      !showOrbitPaths ||
      moons.length === 0 ||
      !isMoonParentCollapsed(parentUpper, activeUpper)
    ) {
      lineObject.visible = false;
      return;
    }

    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    if (!buffer || buffer.totalTimesteps === 0) {
      lineObject.visible = false;
      return;
    }
    if (idx < 0 || idx >= buffer.totalTimesteps) {
      lineObject.visible = false;
      return;
    }

    // Resolve cached indices on first valid buffer / after a new sim.
    if (resolvedBufferRef.current !== buffer) {
      parentIdxRef.current = -1;
      moonIdxRef.current = moons.map(() => -1);
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        const bnUpper = bn.toUpperCase();
        if (bnUpper === parentUpper) parentIdxRef.current = i;
        for (let m = 0; m < moons.length; m++) {
          if (bnUpper === moons[m].nameUpper) moonIdxRef.current[m] = i;
        }
      }
      resolvedBufferRef.current = buffer;
    }
    if (parentIdxRef.current < 0) {
      lineObject.visible = false;
      return;
    }

    const preset = state.simulation.simulationParameters.simulationScale.preset;
    const displayFrame = state.simulation.simulationParameters.displayFrame;
    writePivotInto(pivot.current, buffer, idx, displayFrame);

    // Parent position → world (pivot-subtracted, preset-mapped).
    readBodyPositionInto(parentReadVec.current, buffer, idx, parentIdxRef.current);
    parentSimple.current.x = parentReadVec.current.x - pivot.current.x;
    parentSimple.current.y = parentReadVec.current.y - pivot.current.y;
    parentSimple.current.z = parentReadVec.current.z - pivot.current.z;

    const parentR_wu = worldRadius(parentRadiusM, preset);

    // Largest rendered parent→moon distance = ring radius.
    let maxRadius = 0;
    for (let m = 0; m < moons.length; m++) {
      const mi = moonIdxRef.current[m];
      if (mi < 0) continue;
      readBodyPositionInto(moonReadVec.current, buffer, idx, mi);
      moonSimple.current.x = moonReadVec.current.x - pivot.current.x;
      moonSimple.current.y = moonReadVec.current.y - pivot.current.y;
      moonSimple.current.z = moonReadVec.current.z - pivot.current.z;

      worldDistanceFromParent(
        moonSimple.current,
        parentSimple.current,
        parentR_wu,
        worldRadius(moons[m].radiusM, preset),
        preset,
        deltaScratch.current,
        parentUpper,
      );
      const d = Math.sqrt(
        deltaScratch.current.x * deltaScratch.current.x +
          deltaScratch.current.y * deltaScratch.current.y +
          deltaScratch.current.z * deltaScratch.current.z,
      );
      if (d > maxRadius) maxRadius = d;
    }

    if (maxRadius <= 0) {
      lineObject.visible = false;
      return;
    }

    setBodyWorldPositionWithPreset(
      lineObject.position,
      parentSimple.current,
      preset,
    );
    lineObject.scale.setScalar(maxRadius);
    lineObject.visible = true;
  });
  /* eslint-enable react-hooks/immutability */

  return <primitive object={lineObject} />;
};

export default MoonSystemRing;
