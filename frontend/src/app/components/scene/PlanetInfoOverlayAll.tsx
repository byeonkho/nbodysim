import React, { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { RootState } from "@/app/store/Store";
import { scaleDistance } from "@/app/utils/helpers";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import * as THREE from "three";

interface PlanetInfoOverlayAllProps {
  bodyName: string;
}

const PlanetInfoOverlayAll: React.FC<PlanetInfoOverlayAllProps> = ({
  bodyName,
}) => {
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const store = useStore<RootState>();
  const groupRef = useRef<THREE.Group>(null!);

  const upperName = bodyName.trim().toUpperCase();
  const properties: CelestialBodyProperties | undefined =
    celestialBodyPropertiesList?.find(
      (p) => p.name?.trim().toUpperCase() === upperName,
    );
  const orbitingNameUpper =
    properties?.orbitingBody?.trim().toUpperCase() ?? "";

  useFrame(() => {
    if (!groupRef.current || !properties) return;

    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = selectCurrentTimeStepKey(state);
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;

    const body = snapshot.find(
      (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
    );
    if (!body) return;

    let pos: Vector3Simple = body.position;
    if (
      properties.positionScale !== undefined &&
      properties.positionScale !== 1 &&
      orbitingNameUpper
    ) {
      const orbiting = snapshot.find(
        (b: CelestialBody) =>
          b.name.trim().toUpperCase() === orbitingNameUpper,
      );
      if (orbiting) {
        pos = scaleDistance(body.position, orbiting.position, properties.positionScale);
      }
    }

    groupRef.current.position.set(
      pos.x / simulationScale.positionScale,
      pos.y / simulationScale.positionScale,
      pos.z / simulationScale.positionScale,
    );
  });

  if (!properties) return null;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <Box
          style={{
            background: "transparent",
            padding: "4px 8px",
          }}
        >
          <Typography style={{ color: "#fff", margin: 0 }}>
            {bodyName}
          </Typography>
        </Box>
      </Html>
    </group>
  );
};

export default PlanetInfoOverlayAll;
