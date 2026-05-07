import React, { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSelector } from "react-redux";
import {
  CelestialBody,
  selectActiveBody,
  selectBodyRadiusFromName,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";

const Camera: React.FC = () => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBody: CelestialBody | null = useSelector(selectActiveBody);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  // Active body's radius scaled by the current simulationScale.
  const radius =
    useSelector((state: RootState): number | undefined =>
      activeBody && isBodyActive
        ? (
            selectBodyRadiusFromName as (
              state: RootState,
              props: { bodyName: string },
            ) => number
          )(state, { bodyName: activeBody.name })
        : undefined,
    )! / simulationScale.radiusScale;

  // Tracking zoom level (adjusted by mouse scroll). Initial value is
  // overwritten by the framing useEffect once simulationScale is known —
  // any sensible default works here. Reading controlsRef.current during
  // render is a React 19 anti-pattern (would lint-fail) and pointless on
  // first render anyway since the controls haven't mounted yet.
  const trackingZoomRef = useRef<number>(radius ?? 1);

  // Three.js cameras are mutable objects intentionally — configuring them
  // means writing to fields like `near`/`far`. React 19's hook-immutability
  // rule flags this, but it's the canonical three.js pattern.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    camera.near = 0.1;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
  }, [camera]);
  /* eslint-enable react-hooks/immutability */

  // Initial framing: set camera position relative to the current scale's AXES.SIZE
  // so the inner solar system fills a comfortable portion of the view. Re-runs on
  // scale toggle so Realistic ↔ Semi-Realistic both look reasonable on entry.
  useEffect(() => {
    if (!controlsRef.current) return;
    const D = simulationScale.AXES.SIZE;
    camera.position.set(0, D * 0.15, D * 0.3);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
    trackingZoomRef.current = D * 0.3;
  }, [camera, simulationScale]);

  // Listen for mouse wheel events to adjust the tracking zoom.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      console.log("zoom level: ", trackingZoomRef.current);
      e.preventDefault(); // Prevent page scroll.
      // Adjust trackingZoomRef: positive deltaY zooms out, negative zooms in.
      trackingZoomRef.current *= 1 + e.deltaY * 0.001;
      // Clamp the value to a reasonable range.
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

  // Smoothed radius for the body-tracking camera distance. Same pattern
  // as trackingZoomRef — actual value catches up via lerp inside useFrame.
  const smoothRadiusRef = useRef<number>(1);

  useFrame(() => {
    if (isBodyActive && activeBody) {
      // 1. Compute the new target position based on the active body's scaled position.
      const newTarget = new THREE.Vector3(
        activeBody.position.x / simulationScale.positionScale,
        activeBody.position.y / simulationScale.positionScale,
        activeBody.position.z / simulationScale.positionScale,
      );
      // Smoothly update the OrbitControls target.
      controlsRef.current.target.lerp(newTarget, 0.01);

      // 2. Get the current relative vector from the camera to the old target.
      //    Convert that vector to spherical coordinates.
      const relVec = camera.position.clone().sub(controlsRef.current.target);
      const spherical = new THREE.Spherical().setFromVector3(relVec);

      // 3. Update the radius (zoom) using the trackingZoomRef.
      // Smooth the radius to avoid abrupt changes.
      smoothRadiusRef.current = THREE.MathUtils.lerp(
        smoothRadiusRef.current,
        trackingZoomRef.current,
        0.5,
      );
      spherical.radius = smoothRadiusRef.current;

      // 4. Reconstruct the camera's desired position using the unchanged spherical angles.
      const newRelVec = new THREE.Vector3().setFromSpherical(spherical);
      const desiredPosition = controlsRef.current.target.clone().add(newRelVec);

      // Smoothly update the camera position.
      camera.position.lerp(desiredPosition, 0.01);
    }
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.01} // smaller values = more damping
      // maxPolarAngle={Math.PI / 2}
    />
  );
};

export default Camera;
