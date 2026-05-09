import React, { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSelector, useStore } from "react-redux";
import {
  type CameraPreset,
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCameraPreset,
  selectCurrentTimeStepKey,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import { useDevSettings } from "@/app/dev/devSettingsStore";
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { findEarthIndex, writePivotInto } from "@/app/utils/framePivot";
import SimConstants from "@/app/constants/SimConstants";

// ─────────────────────────────────────────────────────────────────────────
// Snap-to-anchor camera model.
//
// On body select:
//   - controls.target SNAPS to the body's exact rendered position.
//   - The camera's offset from the OLD target is captured and applied as
//     the offset from the NEW target — so the user's relative orbital
//     pose (angle, zoom) is preserved across the switch.
//   - Camera position eases (cubic out) over TWEEN_DURATION_MS from its
//     pre-snap position to (newTarget + capturedOffset). Maya/Blender
//     "frame selected" feel.
//
// In steady state (after the tween, or on every frame while a body is
// already selected and moving):
//   - Each frame, target is set to the body's current rendered position.
//   - Camera is delta-shifted by (newTarget - prevTarget), so its offset
//     from the target is preserved as the body moves (or as display
//     frame / scale changes shift the body's rendered position).
//   - OrbitControls.update() runs after our writes — its rotate/zoom
//     paths read camera-target offset, apply user-input deltas, and
//     write back. So user input acts on top of body-tracking naturally.
//
// minDistance (camera-to-body floor):
//   - Wired directly to OrbitControls' built-in `minDistance` prop, computed
//     as renderedRadius × CAMERA_MIN_DISTANCE_MULTIPLIER for the active body.
//   - OrbitControls clamps its dolly path against minDistance, so zoom-in
//     can't drive the camera into the mesh. No custom wheel handler needed.
//
// This replaces the prior architecture where (a) a slow-lerped target
// trailed the body's true position and (b) a manual zoom-radius lerp
// fought OrbitControls' built-in dolly. The lerp-based model produced a
// class of clipping bugs (#65 in todo, now obsoleted) because camera-to-
// lerped-target distance ≠ camera-to-body distance during transitions.
// In the snap model, target IS the body, so those distances are equal
// by construction.
// ─────────────────────────────────────────────────────────────────────────

const TWEEN_DURATION_MS = 250;
const EPSILON = 1e-6;

// Ease-out cubic: snappy start, soft settle. Good fit for body-switch
// transitions because the user wants immediate feedback that something is
// happening, then a calm landing on the new view.
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface TweenState {
  startMs: number;
  startCameraPos: THREE.Vector3;
  // Camera's offset from the OLD target at tween start; preserved as the
  // offset from the NEW target so the user's view angle is consistent
  // across body switches. Recomputed-against each frame so the tween
  // lands at the body's current position even if the body keeps moving
  // during the 250ms transition (sim playing while user clicks a new body).
  capturedOffset: THREE.Vector3;
}

// Compute the active body's current rendered position in scene world
// coords. Mutating: writes into `out` and returns it (or null when the
// snapshot isn't ready or the body isn't in it). Mirrors the pivot/scale
// pipeline applied by Sphere.tsx so target and mesh share coordinates.
function writeBodyRenderedPositionInto(
  out: THREE.Vector3,
  activeBodyName: string,
  state: RootState,
  pivotScratch: Vector3Simple,
  shiftedScratch: Vector3Simple,
  earthIdxRef: { current: number },
): boolean {
  const simulationData = state.simulation.simulationData;
  const currentTimeStepKey = selectCurrentTimeStepKey(state);
  const scale = state.simulation.simulationParameters.simulationScale;
  if (!simulationData || !currentTimeStepKey) return false;

  const snapshot = simulationData[currentTimeStepKey];
  const upperActiveName = activeBodyName.toUpperCase();
  const body = snapshot?.find(
    (b: CelestialBody) => b.name.toUpperCase() === upperActiveName,
  );
  if (!body) return false;

  const displayFrame = state.simulation.simulationParameters.displayFrame;
  if (displayFrame !== "helio" && earthIdxRef.current === -1) {
    earthIdxRef.current = findEarthIndex(snapshot);
  }
  writePivotInto(pivotScratch, snapshot, displayFrame, earthIdxRef.current);
  shiftedScratch.x = body.position.x - pivotScratch.x;
  shiftedScratch.y = body.position.y - pivotScratch.y;
  shiftedScratch.z = body.position.z - pivotScratch.z;

  setBodyWorldPosition(out, shiftedScratch, scale.positionScale);
  return true;
}

const Camera: React.FC = () => {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBodyName: string | null = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const cameraPreset: CameraPreset = useSelector(selectCameraPreset);
  const { orbitDampingFactor } = useDevSettings();
  const store = useStore<RootState>();

  // OrbitControls' minDistance prop. State so React reflows the prop.
  // 0 means "no floor" — used in free-orbit mode (no body active).
  const [minDistance, setMinDistance] = useState<number>(0);

  // Tween state. Non-null while a body-switch animation is in progress.
  const tweenRef = useRef<TweenState | null>(null);

  // Reused across frames — allocation-free pattern.
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const shiftedScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const earthIdxRef = useRef<number>(-1);
  const bodyPosScratch = useRef(new THREE.Vector3());
  const targetDeltaScratch = useRef(new THREE.Vector3());
  const desiredCameraScratch = useRef(new THREE.Vector3());
  // Holds camera-to-body offset for the post-update min-distance safety.
  const safetyDirScratch = useRef(new THREE.Vector3());

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    camera.near = 0.1;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
  }, [camera]);
  /* eslint-enable react-hooks/immutability */

  // Camera preset (top-down vs free) — sets the initial pose. Same
  // behavior as before; runs once per scale/preset change.
  useEffect(() => {
    if (!controlsRef.current) return;
    const D = simulationScale.AXES.SIZE;
    if (cameraPreset === "top-down") {
      camera.position.set(0, D * 0.5, D * 0.05);
    } else {
      camera.position.set(0, D * 0.15, D * 0.3);
    }
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [camera, simulationScale, cameraPreset]);

  // Body-select effect: snap target, capture offset, start tween.
  // Deps intentionally exclude simulationScale and displayFrame —
  // those produce body-position discontinuities that the per-frame
  // tracking branch handles via delta-shift, no tween needed.
  useEffect(() => {
    if (!isBodyActive || !activeBodyName || !controlsRef.current) {
      tweenRef.current = null;
      return;
    }

    const state = store.getState();
    const ok = writeBodyRenderedPositionInto(
      bodyPosScratch.current,
      activeBodyName,
      state,
      pivotScratch.current,
      shiftedScratch.current,
      earthIdxRef,
    );
    if (!ok) {
      // Snapshot not ready yet — defer. The first per-frame tracking
      // tick after data arrives will operate against camera position
      // = preset position, no body-tracking active until then.
      return;
    }

    // Compute body's min distance for OrbitControls' floor.
    const propsList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;
    const bodyProps = propsList?.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === activeBodyName.toUpperCase(),
    );
    const bodyRadius = bodyProps?.radius;
    const min =
      bodyRadius != null
        ? (bodyRadius / simulationScale.radiusScale) *
          SimConstants.CAMERA_MIN_DISTANCE_MULTIPLIER
        : 0;
    setMinDistance(min);

    // Capture camera's current offset from the OLD target. This becomes
    // the offset from the NEW target — preserves spherical pose.
    const capturedOffset = new THREE.Vector3()
      .copy(camera.position)
      .sub(controlsRef.current.target);

    // Bump up if the captured length is below the new body's floor
    // (e.g. user was 0.16 wu from Earth, switching to Sun whose min is
    // ~17 wu). Direction preserved; only length is clamped.
    const offsetLen = capturedOffset.length();
    if (offsetLen < EPSILON) {
      // Degenerate: camera was at target (rare — would require user to
      // pan exactly onto target). Pick an arbitrary up-direction so the
      // tween has a destination.
      capturedOffset.set(0, 1, 0).multiplyScalar(Math.max(min, 1));
    } else if (offsetLen < min) {
      capturedOffset.normalize().multiplyScalar(min);
    }

    // Snap target to the new body. Camera will tween to (target + offset)
    // over TWEEN_DURATION_MS via the per-frame tween branch.
    controlsRef.current.target.copy(bodyPosScratch.current);

    tweenRef.current = {
      startMs: performance.now(),
      startCameraPos: camera.position.clone(),
      capturedOffset,
    };
    // bodyName intentionally NOT included — we don't restart the tween
    // when activeBodyName re-fires with the same value.
  }, [activeBodyName, isBodyActive, simulationScale, store, camera]);

  // Reset minDistance when body deselected. Separate from the tween
  // effect so simulationScale changes don't restart the tween (only
  // recompute min for OrbitControls' floor).
  useEffect(() => {
    if (!isBodyActive || !activeBodyName) {
      setMinDistance(0);
    }
  }, [isBodyActive, activeBodyName]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (!isBodyActive || !activeBodyName) {
      controls.update();
      return;
    }

    const ok = writeBodyRenderedPositionInto(
      bodyPosScratch.current,
      activeBodyName,
      store.getState(),
      pivotScratch.current,
      shiftedScratch.current,
      earthIdxRef,
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

      // Recompute desired position each frame — body may be moving
      // during the tween (sim is playing). Lerp from start toward the
      // moving destination.
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
        // Tween complete — snap to final and clear. Tracking branch
        // takes over next frame.
        camera.position.copy(desiredCameraScratch.current);
        tweenRef.current = null;
      }
    } else {
      // Tracking mode: target follows body, camera delta-shifts by
      // the same amount so its offset is preserved. OrbitControls'
      // update() (called below) reads camera-target offset, applies
      // user-input rotate/zoom deltas, and writes camera position
      // back — so user input acts on top of tracking smoothly.
      targetDeltaScratch.current.copy(bodyPosScratch.current).sub(controls.target);
      camera.position.add(targetDeltaScratch.current);
      controls.target.copy(bodyPosScratch.current);
    }

    controls.update();

    // Hard safety: enforce camera-to-body min distance against the body's
    // ACTUAL rendered position. OrbitControls' built-in `minDistance` prop
    // SHOULD enforce this through its dolly path, but in practice has
    // empirically been seen to leak — possibly due to React state lag on
    // setMinDistance during body switches, possibly OrbitControls' damping
    // applying user input across multiple frames before the next clamp,
    // possibly a drei/three.js version quirk we haven't isolated. This
    // block is the last word: distance from camera to body strictly
    // >= minDistance, no exceptions. If we're inside, push the camera
    // radially outward to the floor along its current direction (or pick
    // an arbitrary up-direction in the degenerate camera-at-body-center
    // case).
    if (minDistance > 0) {
      safetyDirScratch.current
        .copy(camera.position)
        .sub(bodyPosScratch.current);
      const dist = safetyDirScratch.current.length();
      if (dist < minDistance) {
        if (dist > EPSILON) {
          safetyDirScratch.current
            .divideScalar(dist)
            .multiplyScalar(minDistance);
        } else {
          safetyDirScratch.current.set(0, minDistance, 0);
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
      // Pan disabled while tracking — panning would shift target away
      // from the body, but our per-frame tracking branch immediately
      // snaps target back, so the pan would feel like nothing happened.
      enablePan={!isBodyActive}
      minDistance={minDistance > 0 ? minDistance : undefined}
    />
  );
};

export default Camera;
