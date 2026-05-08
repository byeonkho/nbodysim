import React, { useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { RootState } from "@/app/store/Store";

import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  scaleDistance,
  subtractVectors,
  toTitleCase,
} from "@/app/utils/helpers";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import * as THREE from "three";

const PlanetInfoOverlayActive = () => {
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const celestialBodyPropertiesList: CelestialBodyProperties[] = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const distanceRef = useRef<HTMLSpanElement>(null);
  const velocityRef = useRef<HTMLSpanElement>(null);

  // Resolve the active body's properties + parent body name once per
  // identity / scale change (NOT per frame). These are stable inputs to
  // the imperative position calculation in useFrame.
  const upperName = activeBodyName?.trim().toUpperCase() ?? "";
  const activeProps: CelestialBodyProperties | null = upperName
    ? celestialBodyPropertiesList.find(
        (p) => p.name?.trim().toUpperCase() === upperName,
      ) ?? null
    : null;
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";

  // Update text contents lazily — they only change perceptibly every few frames.
  // Throttle by dropping writes when the new formatted string equals the last one.
  const lastDistance = useRef<string>("");
  const lastVelocity = useRef<string>("");

  useFrame(() => {
    if (!isBodyActive || !activeBodyName || !activeProps || !groupRef.current)
      return;

    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = selectCurrentTimeStepKey(state);
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;

    const activeBody = snapshot.find(
      (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
    );
    if (!activeBody) return;

    const orbitingBody = orbitingNameUpper
      ? snapshot.find(
          (b: CelestialBody) =>
            b.name.trim().toUpperCase() === orbitingNameUpper,
        )
      : undefined;
    if (!orbitingBody) return;

    // Anchor position (apply scaleDistance for non-1 positionScale bodies).
    const positionScale = activeProps.positionScale ?? 1;
    let pos: Vector3Simple = activeBody.position;
    if (positionScale !== 1) {
      pos = scaleDistance(activeBody.position, orbitingBody.position, positionScale);
    }
    groupRef.current.position.set(
      pos.x / simulationScale.positionScale,
      pos.y / simulationScale.positionScale,
      pos.z / simulationScale.positionScale,
    );

    // Update displayed distance + velocity values via DOM refs (no React re-render).
    const distance = calculateDistance(
      activeBody.position,
      orbitingBody.position,
      "AU",
    );
    if (distance !== lastDistance.current && distanceRef.current) {
      distanceRef.current.textContent = distance;
      lastDistance.current = distance;
    }

    const velocityDelta: Vector3Simple = subtractVectors(
      activeBody.velocity,
      orbitingBody.velocity,
    );
    const relativeVelocity = formatToKM(calculateMagnitude(velocityDelta));
    if (relativeVelocity !== lastVelocity.current && velocityRef.current) {
      velocityRef.current.textContent = relativeVelocity;
      lastVelocity.current = relativeVelocity;
    }
  });

  // Reset the text caches when the active body changes so the new body's
  // values get written at least once on the first frame.
  useEffect(() => {
    lastDistance.current = "";
    lastVelocity.current = "";
  }, [activeBodyName]);

  if (!activeBodyName || !isBodyActive || !activeProps) return null;
  const orbitingName = activeProps.orbitingBody;
  if (!orbitingName) return null;

  // divider dimensions
  const diagonalLength: number = 20;
  const horizontalLength: number = 200;
  const totalWidth: number = diagonalLength + horizontalLength;
  const totalHeight: number = diagonalLength;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <Box
          style={{
            position: "relative",
            width: totalWidth,
            height: totalHeight,
          }}
        >
          <svg
            width={totalWidth}
            height={totalHeight}
            style={{ position: "absolute", left: 0, bottom: 0 }}
          >
            <line
              x1="0"
              y1={totalHeight}
              x2={diagonalLength}
              y2={totalHeight - diagonalLength}
              stroke="white"
              strokeWidth="3"
            />
            <line
              x1={diagonalLength}
              y1={totalHeight - diagonalLength}
              x2={totalWidth}
              y2={totalHeight - diagonalLength}
              stroke="white"
              strokeWidth="6"
            />
          </svg>

          <Box
            style={{
              position: "absolute",
              left: diagonalLength * 1.5,
              bottom: totalHeight,
              width: horizontalLength,
              textAlign: "left",
            }}
          >
            <Typography variant="h3"> {activeBodyName}</Typography>
          </Box>

          <Box
            style={{
              position: "absolute",
              left: diagonalLength * 1.5,
              top: totalHeight,
              width: horizontalLength,
              textAlign: "left",
            }}
          >
            <Typography variant="body2">
              Distance to {toTitleCase(orbitingName)}:{" "}
              <span ref={distanceRef}></span>
            </Typography>
            <Typography variant="body2">
              Relative Velocity: <span ref={velocityRef}></span>
            </Typography>
          </Box>
        </Box>
      </Html>
    </group>
  );
};

export default PlanetInfoOverlayActive;
