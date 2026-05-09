import React, { useEffect, useRef } from "react";
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
import {
  getDevSettings,
  useDevSettings,
} from "@/app/dev/devSettingsStore";
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { findEarthIndex, writePivotInto } from "@/app/utils/framePivot";
import SimConstants from "@/app/constants/SimConstants";

const Camera: React.FC = () => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBodyName: string | null = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const cameraPreset: CameraPreset = useSelector(selectCameraPreset);
  const { orbitDampingFactor } = useDevSettings();
  const store = useStore<RootState>();

  // Active body's radius scaled by the current simulationScale.
  // Pulled imperatively from the props list; only re-derived on identity change.
  const activeRadius = (() => {
    if (!activeBodyName || !isBodyActive) return undefined;
    const propsList =
      store.getState().simulation.simulationParameters
        .celestialBodyPropertiesList;
    const bodyProps = propsList.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === activeBodyName.toUpperCase(),
    );
    return bodyProps?.radius;
  })();
  const radius = (activeRadius ?? 1) / simulationScale.radiusScale;

  const trackingZoomRef = useRef<number>(radius);
  // Floor for trackingZoomRef so the active-body zoom can't clip into
  // the body. Recomputed on body switch and scale toggle (since rendered
  // radius depends on simulationScale.radiusScale). 0 when no body is
  // active — the wheel handler treats 0 as "no floor" via Math.max with
  // a tiny epsilon, keeping the original behavior for free-orbit mode.
  const minTrackingZoomRef = useRef<number>(0);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    camera.near = 0.1;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
  }, [camera]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (!controlsRef.current) return;
    const D = simulationScale.AXES.SIZE;
    // Two binary presets (Phase 2 of redesign):
    // - "top-down": ecliptic-plane view that the design's compass and
    //   ghost labels assume. Tiny forward offset avoids OrbitControls
    //   pole gimbal lock.
    // - "free": the original perspective view; user-friendly first frame
    //   for unconstrained orbiting.
    if (cameraPreset === "top-down") {
      camera.position.set(0, D * 0.5, D * 0.05);
      trackingZoomRef.current = D * 0.5;
    } else {
      camera.position.set(0, D * 0.15, D * 0.3);
      trackingZoomRef.current = D * 0.3;
    }
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [camera, simulationScale, cameraPreset]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoomSensitivity } = getDevSettings();
      trackingZoomRef.current *= 1 + e.deltaY * zoomSensitivity;
      // Lower bound is body-radius-aware when a body is active, falls
      // back to a tiny epsilon when not (free-orbit doesn't use this
      // value, so the floor is just a sanity guard).
      trackingZoomRef.current = THREE.MathUtils.clamp(
        trackingZoomRef.current,
        Math.max(minTrackingZoomRef.current, 0.00001),
        1e20,
      );
    };

    gl.domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      gl.domElement.removeEventListener("wheel", onWheel);
    };
  }, [gl.domElement]);

  // Recompute the camera-distance floor whenever the active body changes
  // OR the scale preset changes. Both move the rendered radius (the
  // latter by changing simulationScale.radiusScale on a live toggle).
  // If the existing trackingZoom is now below the floor — e.g. user was
  // 0.05 wu from Earth and switched to Sun, or toggled from Realistic
  // (Earth ~0.064 wu) to a future preset with a larger Earth — bump it
  // up so the next frame's lerp doesn't drive the camera through the
  // surface.
  useEffect(() => {
    if (!activeBodyName || !isBodyActive) {
      minTrackingZoomRef.current = 0;
      return;
    }
    const propsList =
      store.getState().simulation.simulationParameters
        .celestialBodyPropertiesList;
    const bodyProps = propsList?.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === activeBodyName.toUpperCase(),
    );
    const bodyRadius = bodyProps?.radius;
    if (bodyRadius == null) {
      minTrackingZoomRef.current = 0;
      return;
    }
    const renderedRadius = bodyRadius / simulationScale.radiusScale;
    const min = renderedRadius * SimConstants.CAMERA_MIN_DISTANCE_MULTIPLIER;
    minTrackingZoomRef.current = min;
    if (trackingZoomRef.current < min) {
      trackingZoomRef.current = min;
    }
  }, [activeBodyName, isBodyActive, simulationScale, store]);

  // Reused across frames — no per-frame allocation.
  const targetScratch = useRef(new THREE.Vector3());
  const offsetScratch = useRef(new THREE.Vector3());
  // Frame-pivot scratches for display-frame transform (geo mode anchors
  // Earth at world origin). Same allocation-free pattern as Sphere.tsx.
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const shiftedScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const earthIdxRef = useRef<number>(-1);

  useFrame(() => {
    if (isBodyActive && activeBodyName) {
      // Read the live snapshot for the active body imperatively.
      const state = store.getState();
      const simulationData = state.simulation.simulationData;
      const currentTimeStepKey = selectCurrentTimeStepKey(state);
      const scale = state.simulation.simulationParameters.simulationScale;

      if (simulationData && currentTimeStepKey) {
        const snapshot = simulationData[currentTimeStepKey];
        // Case-insensitive lookup — every other body match in the
        // codebase upper-cases on both sides; matching that convention
        // avoids a silent miss if naming case ever drifts (e.g. backend
        // canonicalizes to upper-case but BodySelector keeps mixed-case
        // BODY_DISPLAY values). When the lookup misses, the camera-
        // tracking branch silently no-ops and the min-distance floor
        // never gets enforced, so this match needs to be robust.
        const upperActiveName = activeBodyName.toUpperCase();
        const body = snapshot?.find(
          (b: CelestialBody) => b.name.toUpperCase() === upperActiveName,
        );
        if (body) {
          // Apply display-frame pivot: in geo mode the active body
          // renders at (body - earth), so the camera target has to track
          // the same coordinate. Without this the camera would lerp
          // toward the body's heliocentric position — empty space, 1 AU
          // from where the body actually is.
          const displayFrame =
            state.simulation.simulationParameters.displayFrame;
          if (displayFrame !== "helio" && earthIdxRef.current === -1) {
            earthIdxRef.current = findEarthIndex(snapshot);
          }
          writePivotInto(
            pivotScratch.current,
            snapshot,
            displayFrame,
            earthIdxRef.current,
          );
          shiftedScratch.current.x = body.position.x - pivotScratch.current.x;
          shiftedScratch.current.y = body.position.y - pivotScratch.current.y;
          shiftedScratch.current.z = body.position.z - pivotScratch.current.z;

          setBodyWorldPosition(
            targetScratch.current,
            shiftedScratch.current,
            scale.positionScale,
          );
          controlsRef.current.target.lerp(targetScratch.current, 0.01);

          offsetScratch.current
            .copy(camera.position)
            .sub(controlsRef.current.target);
          const currentRadius = offsetScratch.current.length();
          if (currentRadius > 0) offsetScratch.current.divideScalar(currentRadius);

          const { cameraZoomLerpRate } = getDevSettings();
          const newRadius = THREE.MathUtils.lerp(
            currentRadius,
            trackingZoomRef.current,
            cameraZoomLerpRate,
          );

          camera.position
            .copy(controlsRef.current.target)
            .addScaledVector(offsetScratch.current, newRadius);
        }
      }
    }
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={orbitDampingFactor}
      enableZoom={!isBodyActive}
    />
  );
};

export default Camera;
