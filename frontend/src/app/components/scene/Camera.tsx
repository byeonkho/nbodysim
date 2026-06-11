import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSelector, useStore } from "react-redux";
import {
  type CameraPreset,
  selectActiveBodyName,
  selectCameraPreset,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto, type ChunkBuffer } from "@/app/store/chunkBuffer";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import { useDevSettings } from "@/app/dev/devSettingsStore";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { worldRadius, worldDistanceFromParent, ScalePreset } from "@/app/utils/scalePipeline";
import SimConstants from "@/app/constants/SimConstants";

// ─────────────────────────────────────────────────────────────────────────
// Snap-to-anchor camera model. See pre-buffer version of this file for the
// full rationale comment; the behavior is unchanged after the migration —
// only the body-position read swaps from snapshot-find to chunkBuffer index.
// ─────────────────────────────────────────────────────────────────────────

const TWEEN_DURATION_MS = 250;
const EPSILON = 1e-6;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface TweenState {
  startMs: number;
  startCameraPos: THREE.Vector3;
  capturedOffset: THREE.Vector3;
}

// Module-level scratches — allocated once, mutated in place. Never new'd per call.
const bodyReadScratch = new THREE.Vector3();
const parentReadScratch: Vector3Simple = { x: 0, y: 0, z: 0 };
const parentShiftedScratch: Vector3Simple = { x: 0, y: 0, z: 0 };
const parentWorldScratchVec3 = new THREE.Vector3();
const childDeltaScratch: Vector3Simple = { x: 0, y: 0, z: 0 };

// PropsByUpperName values carry a pre-uppercased orbitingBody so the hot path
// never has to `.toUpperCase()` per frame. Built at component level via useMemo;
// keyed on `propsList` identity.
interface UpperCachedProps {
  radius?: number;
  orbitingBodyUpper?: string;
}

function writeBodyRenderedPositionInto(
  out: THREE.Vector3,
  activeBodyNameUpper: string,
  propsByUpperName: Map<string, UpperCachedProps>,
  bodyIdxByUpperName: Map<string, number>,
  state: RootState,
  pivotScratch: Vector3Simple,
  shiftedScratch: Vector3Simple,
  preset: ScalePreset,
): boolean {
  const buffer = state.simulation.chunkBuffer;
  const idx = state.simulation.timeState.currentTimeStepIndex;
  if (!buffer || idx >= buffer.totalTimesteps) return false;

  const bodyIdx = bodyIdxByUpperName.get(activeBodyNameUpper);
  if (bodyIdx === undefined) return false;

  readBodyPositionInto(bodyReadScratch, buffer, idx, bodyIdx);

  const displayFrame = state.simulation.simulationParameters.displayFrame;
  writePivotInto(pivotScratch, buffer, idx, displayFrame);
  shiftedScratch.x = bodyReadScratch.x - pivotScratch.x;
  shiftedScratch.y = bodyReadScratch.y - pivotScratch.y;
  shiftedScratch.z = bodyReadScratch.z - pivotScratch.z;

  const bodyProps = propsByUpperName.get(activeBodyNameUpper);
  const orbitingBodyNameUpper = bodyProps?.orbitingBodyUpper;
  const ownRadiusM = bodyProps?.radius ?? 0;

  if (orbitingBodyNameUpper) {
    const parentIdx = bodyIdxByUpperName.get(orbitingBodyNameUpper);

    if (parentIdx !== undefined) {
      // Read and pivot-subtract parent position.
      readBodyPositionInto(bodyReadScratch, buffer, idx, parentIdx);
      parentReadScratch.x = bodyReadScratch.x;
      parentReadScratch.y = bodyReadScratch.y;
      parentReadScratch.z = bodyReadScratch.z;
      parentShiftedScratch.x = parentReadScratch.x - pivotScratch.x;
      parentShiftedScratch.y = parentReadScratch.y - pivotScratch.y;
      parentShiftedScratch.z = parentReadScratch.z - pivotScratch.z;

      const parentProps = propsByUpperName.get(orbitingBodyNameUpper);
      const parentRadiusM = parentProps?.radius ?? 0;

      // Parent's world-unit position via the pipeline.
      setBodyWorldPositionWithPreset(parentWorldScratchVec3, parentShiftedScratch, preset);

      // Child world-relative-to-parent delta with min-separation rule.
      worldDistanceFromParent(
        shiftedScratch,
        parentShiftedScratch,
        worldRadius(parentRadiusM, preset),
        worldRadius(ownRadiusM, preset),
        preset,
        childDeltaScratch,
        orbitingBodyNameUpper,
      );

      // Apply Y/Z swap to delta (matches Sphere pattern).
      out.set(
        parentWorldScratchVec3.x + childDeltaScratch.x,
        parentWorldScratchVec3.y + childDeltaScratch.z,
        parentWorldScratchVec3.z + childDeltaScratch.y,
      );
      return true;
    }
  }

  setBodyWorldPositionWithPreset(out, shiftedScratch, preset);
  return true;
}

const EMPTY_PROPS_MAP: Map<string, UpperCachedProps> = new Map();
const EMPTY_INDEX_MAP: Map<string, number> = new Map();

const Camera: React.FC = () => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBodyName: string | null = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const cameraPreset: CameraPreset = useSelector(selectCameraPreset);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const { orbitDampingFactor } = useDevSettings();
  const store = useStore<RootState>();

  const minDistanceRef = useRef<number>(0);
  const tweenRef = useRef<TweenState | null>(null);

  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const shiftedScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const bodyPosScratch = useRef(new THREE.Vector3());
  const targetDeltaScratch = useRef(new THREE.Vector3());
  const desiredCameraScratch = useRef(new THREE.Vector3());
  const safetyDirScratch = useRef(new THREE.Vector3());

  // Pre-uppercase lookup map for body properties. Eliminates per-frame
  // `propsList.find(... .toUpperCase() ...)` linear scans. Rebuilds only
  // when propsList identity changes (rare — once per chunk merge that
  // updates µ, plus loadSimulation).
  const propsByUpperName = useMemo<Map<string, UpperCachedProps>>(() => {
    if (!propsList) return EMPTY_PROPS_MAP;
    const map = new Map<string, UpperCachedProps>();
    for (const bp of propsList) {
      if (!bp.name) continue;
      map.set(bp.name.toUpperCase(), {
        radius: bp.radius,
        orbitingBodyUpper: bp.orbitingBody?.toUpperCase(),
      });
    }
    return map;
  }, [propsList]);

  // Pre-uppercased active body name. Eliminates per-frame
  // `activeBodyName.toUpperCase()` allocation.
  const activeBodyNameUpper = useMemo(
    () => activeBodyName?.toUpperCase() ?? null,
    [activeBodyName],
  );

  // Buffer-index map keyed by uppercase name. The chunkBuffer is read from
  // store.getState() (not subscribed) so we can't useMemo on it directly —
  // instead, cache by buffer identity and rebuild only when a new buffer
  // arrives (new session). Backend already uppercases names at body
  // construction so buffer.bodyNameToIndex keys are upper today, but we
  // rebuild defensively to avoid coupling to that invariant.
  const bufferIdxRef = useRef<{
    buffer: ChunkBuffer | null;
    map: Map<string, number>;
  }>({ buffer: null, map: EMPTY_INDEX_MAP });

  const getBodyIdxByUpperName = (
    buffer: ChunkBuffer | null,
  ): Map<string, number> => {
    if (!buffer) return EMPTY_INDEX_MAP;
    if (bufferIdxRef.current.buffer === buffer) return bufferIdxRef.current.map;
    const map = new Map<string, number>();
    for (let i = 0; i < buffer.bodyNames.length; i++) {
      map.set(buffer.bodyNames[i].toUpperCase(), i);
    }
    bufferIdxRef.current = { buffer, map };
    return map;
  };

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    camera.near = 0.001;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
  }, [camera]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (!controlsRef.current) return;
    const D = simulationScale.AXES.SIZE;
    if (cameraPreset === "top-down") {
      camera.position.set(0, D * 0.5, D * 0.05);
    } else {
      camera.position.set(0, D * 0.15, D * 0.3);
    }
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.maxDistance = Math.min(
      D * SimConstants.CAMERA_MAX_DISTANCE_MULTIPLIER,
      SimConstants.STARS_RADIUS * 0.9,
    );
    controlsRef.current.update();
  }, [camera, simulationScale, cameraPreset]);

  useEffect(() => {
    if (!isBodyActive || !activeBodyNameUpper || !controlsRef.current) {
      tweenRef.current = null;
      minDistanceRef.current = 0;
      if (controlsRef.current) controlsRef.current.minDistance = 0;
      return;
    }

    const state = store.getState();
    const preset = simulationScale.preset;
    const bodyIdxByUpperName = getBodyIdxByUpperName(state.simulation.chunkBuffer);
    const ok = writeBodyRenderedPositionInto(
      bodyPosScratch.current,
      activeBodyNameUpper,
      propsByUpperName,
      bodyIdxByUpperName,
      state,
      pivotScratch.current,
      shiftedScratch.current,
      preset,
    );
    if (!ok) return;

    const bodyProps = propsByUpperName.get(activeBodyNameUpper);
    const bodyRadius = bodyProps?.radius;
    const min =
      bodyRadius != null
        ? worldRadius(bodyRadius, preset) *
          SimConstants.CAMERA_MIN_DISTANCE_MULTIPLIER
        : 0;
    minDistanceRef.current = min;
    controlsRef.current.minDistance = min;

    const capturedOffset = new THREE.Vector3()
      .copy(camera.position)
      .sub(controlsRef.current.target);

    const offsetLen = capturedOffset.length();
    if (offsetLen < EPSILON) {
      capturedOffset.set(0, 1, 0).multiplyScalar(Math.max(min, 1));
    } else if (offsetLen < min) {
      capturedOffset.normalize().multiplyScalar(min);
    }

    controlsRef.current.target.copy(bodyPosScratch.current);

    tweenRef.current = {
      startMs: performance.now(),
      startCameraPos: camera.position.clone(),
      capturedOffset,
    };
  }, [
    activeBodyNameUpper,
    isBodyActive,
    simulationScale,
    store,
    camera,
    propsByUpperName,
  ]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (!isBodyActive || !activeBodyNameUpper) {
      controls.update();
      return;
    }

    const frameState = store.getState();
    const bodyIdxByUpperName = getBodyIdxByUpperName(
      frameState.simulation.chunkBuffer,
    );
    const ok = writeBodyRenderedPositionInto(
      bodyPosScratch.current,
      activeBodyNameUpper,
      propsByUpperName,
      bodyIdxByUpperName,
      frameState,
      pivotScratch.current,
      shiftedScratch.current,
      frameState.simulation.simulationParameters.simulationScale.preset,
    );
    if (!ok) {
      controls.update();
      return;
    }

    const tween = tweenRef.current;
    if (tween) {
      const t = Math.min(
        (performance.now() - tween.startMs) / TWEEN_DURATION_MS,
        1,
      );
      const easedT = easeOutCubic(t);

      desiredCameraScratch.current
        .copy(bodyPosScratch.current)
        .add(tween.capturedOffset);
      camera.position.lerpVectors(
        tween.startCameraPos,
        desiredCameraScratch.current,
        easedT,
      );
      controls.target.copy(bodyPosScratch.current);

      if (t >= 1) {
        camera.position.copy(desiredCameraScratch.current);
        tweenRef.current = null;
      }
    } else {
      targetDeltaScratch.current
        .copy(bodyPosScratch.current)
        .sub(controls.target);
      camera.position.add(targetDeltaScratch.current);
      controls.target.copy(bodyPosScratch.current);
    }

    controls.update();

    const minDist = minDistanceRef.current;
    if (minDist > 0) {
      safetyDirScratch.current
        .copy(camera.position)
        .sub(bodyPosScratch.current);
      const dist = safetyDirScratch.current.length();
      if (dist < minDist) {
        if (dist > EPSILON) {
          safetyDirScratch.current.divideScalar(dist).multiplyScalar(minDist);
        } else {
          safetyDirScratch.current.set(0, minDist, 0);
        }
        camera.position
          .copy(bodyPosScratch.current)
          .add(safetyDirScratch.current);
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={orbitDampingFactor}
      enableZoom
      enablePan={!isBodyActive}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
    />
  );
};

export default Camera;
