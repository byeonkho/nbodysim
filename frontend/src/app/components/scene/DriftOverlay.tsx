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
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import {
  setBodyWorldPositionWithPreset,
  writeBodyWorldPositionToArrayWithPreset,
} from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { worldRadius } from "@/app/utils/scalePipeline";
import { getDevSettings } from "@/app/dev/devSettingsStore";

// Truth = warm yellow; the connector showing the gap = red. Matches the
// design mockups for the drift overlay.
const TRUE_COLOR: [number, number, number] = [1.0, 0.82, 0.4];
const CONNECTOR_COLOR: [number, number, number] = [1.0, 0.36, 0.45];
const MAX_TRAIL_POINTS = 5000;

/**
 * Reality-drift overlay for the active body: a true-position trail, a ghost
 * marker at the body's true current position, and a line from the predicted
 * position to the true one. Reads the Tier-2 true-track buffer (a single-body
 * ChunkBuffer at index 0) and the predicted buffer imperatively in one
 * useFrame. Reuses the predicted body's exact transform chain (read → frame
 * pivot off the PREDICTED buffer → scale + Y/Z swap) so it shares world space.
 *
 * Mounted only when the overlay is on AND the active body has a true track
 * (Scene gates the mount); this component additionally hides its geometry when
 * the buffers aren't ready so a mid-frame gap shows nothing rather than stale.
 */
const DriftOverlay: React.FC = () => {
  const store = useStore<RootState>();
  const activeBodyName = useSelector(selectActiveBodyName);
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  // Active body's real radius (metres) → marker sized like the body so the two
  // coincide at t=0. Subscribed (not per-frame); recomputed on selection.
  const activeRadiusM = useMemo(() => {
    const upper = activeBodyName?.toUpperCase();
    if (!upper) return 0;
    const p = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === upper,
    );
    return p?.radius ?? 0;
  }, [activeBodyName, propsList]);

  // --- three.js objects, allocated once ---
  const trailLine = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS * 3), 3));
    geom.setDrawRange(0, 0);
    const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ vertexColors: true }));
    line.frustumCulled = false;
    return line;
  }, []);

  const connectorLine = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
    const line = new THREE.Line(
      geom,
      new THREE.LineBasicMaterial({ color: new THREE.Color(...CONNECTOR_COLOR) }),
    );
    line.frustumCulled = false;
    return line;
  }, []);

  const markerMesh = useMemo(() => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(...TRUE_COLOR),
        wireframe: true,
        transparent: true,
        opacity: 0.9,
      }),
    );
    mesh.frustumCulled = false;
    return mesh;
  }, []);

  useEffect(() => {
    return () => {
      trailLine.geometry.dispose();
      (trailLine.material as THREE.Material).dispose();
      connectorLine.geometry.dispose();
      (connectorLine.material as THREE.Material).dispose();
      markerMesh.geometry.dispose();
      (markerMesh.material as THREE.Material).dispose();
    };
  }, [trailLine, connectorLine, markerMesh]);

  // Scratch — never allocated per frame.
  const truePos = useRef(new THREE.Vector3());
  const predPos = useRef(new THREE.Vector3());
  const trueSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const predSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const pivot = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const predWorld = useRef(new THREE.Vector3());

  // Cached predicted-buffer index for the ACTIVE body. Invalidated when the
  // buffer identity changes (resubmit) OR the active body changes (focus
  // switch) — this index tracks whichever body is focused, which changes
  // mid-session without changing the buffer.
  const predIdxRef = useRef<number>(-1);
  const resolvedBufferRef = useRef<object | null>(null);
  const resolvedBodyRef = useRef<string | null>(null);

  /* eslint-disable react-hooks/immutability */
  useFrame(() => {
    const state = store.getState();
    const gt = state.groundTruth;
    const predicted = state.simulation.chunkBuffer;
    const trueTrack = gt.trueTrack;
    const active = state.simulation.activeBodyState.activeBodyName;

    if (
      !gt.overlayEnabled ||
      !predicted ||
      !trueTrack ||
      !active ||
      gt.trueTrackBody !== active.toUpperCase() ||
      predicted.totalTimesteps === 0 ||
      trueTrack.totalTimesteps === 0
    ) {
      trailLine.geometry.setDrawRange(0, 0);
      markerMesh.visible = false;
      connectorLine.visible = false;
      return;
    }

    const idx = state.simulation.timeState.currentTimeStepIndex;
    const preset = state.simulation.simulationParameters.simulationScale.preset;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    if (idx >= predicted.totalTimesteps || idx >= trueTrack.totalTimesteps) {
      trailLine.geometry.setDrawRange(0, 0);
      markerMesh.visible = false;
      connectorLine.visible = false;
      return;
    }

    // Resolve / re-resolve the predicted index for the active body. Re-resolve
    // on buffer identity change (resubmit) AND on active-body change — the
    // connector reads the focused body's predicted position, and focus changes
    // mid-session without changing the buffer (which would otherwise keep the
    // previous body's index and point the line at the old body).
    const activeUpper = active.toUpperCase();
    if (
      resolvedBufferRef.current !== predicted ||
      resolvedBodyRef.current !== activeUpper
    ) {
      predIdxRef.current = -1;
      resolvedBufferRef.current = predicted;
      resolvedBodyRef.current = activeUpper;
    }
    if (predIdxRef.current === -1) {
      for (const [bn, i] of predicted.bodyNameToIndex.entries()) {
        if (bn.toUpperCase() === activeUpper) {
          predIdxRef.current = i;
          break;
        }
      }
    }
    const predIdx = predIdxRef.current;
    if (predIdx < 0) {
      trailLine.geometry.setDrawRange(0, 0);
      markerMesh.visible = false;
      connectorLine.visible = false;
      return;
    }

    // --- true trail (read true-track body 0 over the tail window) ---
    const positions = trailLine.geometry.attributes.position.array as Float32Array;
    const colors = trailLine.geometry.attributes.color.array as Float32Array;
    const length = Math.min(MAX_TRAIL_POINTS, getDevSettings().trailLength);
    const idxFloor = Math.floor(idx);
    const start = Math.max(0, idxFloor - length);
    const end = Math.min(idxFloor, trueTrack.totalTimesteps - 1);
    const total = end - start;
    let count = 0;
    for (let i = start; i <= end; i++) {
      readBodyPositionInto(truePos.current, trueTrack, i, 0);
      // Frame pivot comes from the PREDICTED buffer (predicted Earth), so the
      // true trail shares world space with everything else (design §6).
      writePivotInto(pivot.current, predicted, i, displayFrame);
      trueSimple.current.x = truePos.current.x - pivot.current.x;
      trueSimple.current.y = truePos.current.y - pivot.current.y;
      trueSimple.current.z = truePos.current.z - pivot.current.z;
      const w = count * 3;
      writeBodyWorldPositionToArrayWithPreset(positions, w, trueSimple.current, preset);
      const fade = total > 0 ? (i - start) / total : 1;
      colors[w] = TRUE_COLOR[0] * fade;
      colors[w + 1] = TRUE_COLOR[1] * fade;
      colors[w + 2] = TRUE_COLOR[2] * fade;
      count++;
    }
    trailLine.geometry.setDrawRange(0, count);
    trailLine.geometry.attributes.position.needsUpdate = true;
    trailLine.geometry.attributes.color.needsUpdate = true;

    // --- current true position → marker (world space) ---
    readBodyPositionInto(truePos.current, trueTrack, idx, 0);
    writePivotInto(pivot.current, predicted, idx, displayFrame);
    trueSimple.current.x = truePos.current.x - pivot.current.x;
    trueSimple.current.y = truePos.current.y - pivot.current.y;
    trueSimple.current.z = truePos.current.z - pivot.current.z;
    setBodyWorldPositionWithPreset(markerMesh.position, trueSimple.current, preset);
    const markerR = worldRadius(activeRadiusM, preset);
    markerMesh.scale.setScalar(markerR > 0 ? markerR : 0.3);
    markerMesh.visible = true;

    // --- current predicted position → connector start (world space) ---
    readBodyPositionInto(predPos.current, predicted, idx, predIdx);
    predSimple.current.x = predPos.current.x - pivot.current.x;
    predSimple.current.y = predPos.current.y - pivot.current.y;
    predSimple.current.z = predPos.current.z - pivot.current.z;
    setBodyWorldPositionWithPreset(predWorld.current, predSimple.current, preset);

    const conn = connectorLine.geometry.attributes.position.array as Float32Array;
    conn[0] = predWorld.current.x;
    conn[1] = predWorld.current.y;
    conn[2] = predWorld.current.z;
    conn[3] = markerMesh.position.x;
    conn[4] = markerMesh.position.y;
    conn[5] = markerMesh.position.z;
    connectorLine.geometry.attributes.position.needsUpdate = true;
    connectorLine.visible = true;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <primitive object={trailLine} />
      <primitive object={connectorLine} />
      <primitive object={markerMesh} />
    </>
  );
};

export default DriftOverlay;
