import React, { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCurrentTimeStepKey,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import {
  getDevSettings,
  useDevSettings,
} from "@/app/dev/devSettingsStore";

const Camera: React.FC = () => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBodyName: string | null = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
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
    camera.position.set(0, D * 0.15, D * 0.3);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
    trackingZoomRef.current = D * 0.3;
  }, [camera, simulationScale]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoomSensitivity } = getDevSettings();
      trackingZoomRef.current *= 1 + e.deltaY * zoomSensitivity;
      trackingZoomRef.current = THREE.MathUtils.clamp(
        trackingZoomRef.current,
        0.00001,
        1e20,
      );
    };

    gl.domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      gl.domElement.removeEventListener("wheel", onWheel);
    };
  }, [gl.domElement]);

  // Reuse one Vector3 across frames — no per-frame allocation.
  const targetScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (isBodyActive && activeBodyName) {
      // Read the live snapshot for the active body imperatively.
      const state = store.getState();
      const simulationData = state.simulation.simulationData;
      const currentTimeStepKey = selectCurrentTimeStepKey(state);
      const scale = state.simulation.simulationParameters.simulationScale;

      if (simulationData && currentTimeStepKey) {
        const snapshot = simulationData[currentTimeStepKey];
        const body = snapshot?.find(
          (b: CelestialBody) => b.name === activeBodyName,
        );
        if (body) {
          targetScratch.current.set(
            body.position.x / scale.positionScale,
            body.position.y / scale.positionScale,
            body.position.z / scale.positionScale,
          );
          controlsRef.current.target.lerp(targetScratch.current, 0.01);

          const offset = camera.position
            .clone()
            .sub(controlsRef.current.target);
          const currentRadius = offset.length();
          if (currentRadius > 0) offset.divideScalar(currentRadius);

          const { cameraZoomLerpRate } = getDevSettings();
          const newRadius = THREE.MathUtils.lerp(
            currentRadius,
            trackingZoomRef.current,
            cameraZoomLerpRate,
          );

          camera.position
            .copy(controlsRef.current.target)
            .addScaledVector(offset, newRadius);
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
