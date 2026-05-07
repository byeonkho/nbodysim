import React from "react";
import { Html } from "@react-three/drei";
import {
  CelestialBody,
  selectCelestialBodyPropertiesList,
  selectCurrentSimulationSnapshot,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { useSelector } from "react-redux";
import { scaleDistance } from "@/app/utils/helpers";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface PlanetInfoOverlayItemProps {
  body: CelestialBody;
}

const PlanetInfoOverlayAll: React.FC<PlanetInfoOverlayItemProps> = ({
  body,
}) => {
  const simulationSnapshot: CelestialBody[] = useSelector(
    selectCurrentSimulationSnapshot,
  );
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );

  // Prepare the body name for lookup
  const bodyName: string = body.name.trim().toUpperCase();

  // Look up the corresponding properties for this body.
  const properties = celestialBodyPropertiesList?.find(
    (props) => props.name?.trim().toUpperCase() === bodyName,
  );

  // Calculate position.
  let position: [number, number, number];
  // If this body has a special position scale (i.e., an exception) and has an orbiting body defined:
  if (
    properties?.positionScale !== undefined &&
    properties.positionScale !== 1 &&
    properties.orbitingBody
  ) {
    // Capture into a local const so TS's narrowing survives into the closure below.
    const orbitingBodyName = properties.orbitingBody;
    const orbitingBody = simulationSnapshot.find(
      (b: CelestialBody) =>
        b.name.trim().toUpperCase() ===
        orbitingBodyName.trim().toUpperCase(),
    );
    if (orbitingBody) {
      const scaled: Vector3Simple = scaleDistance(
        body.position,
        orbitingBody.position,
        properties.positionScale,
      );
      position = [
        scaled.x / simulationScale.positionScale,
        scaled.y / simulationScale.positionScale,
        scaled.z / simulationScale.positionScale,
      ];
    } else {
      // Fallback: use raw position.
      position = [
        body.position.x / simulationScale.positionScale,
        body.position.y / simulationScale.positionScale,
        body.position.z / simulationScale.positionScale,
      ];
    }
  } else {
    position = [
      body.position.x / simulationScale.positionScale,
      body.position.y / simulationScale.positionScale,
      body.position.z / simulationScale.positionScale,
    ];
  }

  return (
    <Html position={position} style={{ pointerEvents: "none" }}>
      <Box
        style={{
          background: "transparent",
          padding: "4px 8px", // TODO
        }}
      >
        <Typography style={{ color: "#fff", margin: 0 }}>
          {body.name}
        </Typography>
      </Box>
    </Html>
  );
};

export default PlanetInfoOverlayAll;
