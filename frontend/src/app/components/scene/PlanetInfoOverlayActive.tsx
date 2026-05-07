import React from "react";
import { Html } from "@react-three/drei";
import { useSelector } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBody,
  selectCelestialBodyPropertiesList,
  selectCurrentSimulationSnapshot,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";

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

const PlanetInfoOverlayActive = () => {
  const activeBody: CelestialBody | null = useSelector(selectActiveBody);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationSnapshot: CelestialBody[] = useSelector(
    selectCurrentSimulationSnapshot,
  );
  const celestialBodyPropertiesList: CelestialBodyProperties[] =
    useSelector(selectCelestialBodyPropertiesList);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  // All hooks must run every render — early returns go AFTER hook calls.
  if (!activeBody || !isBodyActive) {
    return null;
  }

  const activeNameUpper = activeBody.name?.trim().toUpperCase();
  const activeBodyProperties = celestialBodyPropertiesList.find(
    (props) => props.name?.trim().toUpperCase() === activeNameUpper,
  );
  if (!activeBodyProperties) return null;

  const orbitingBodyName = activeBodyProperties.orbitingBody;
  if (!orbitingBodyName) return null;

  const activeBodySnapshot = simulationSnapshot.find(
    (body) => body.name.trim().toUpperCase() === activeNameUpper,
  );
  const orbitingBodySnapshot = simulationSnapshot.find(
    (body) =>
      body.name.trim().toUpperCase() ===
      orbitingBodyName.trim().toUpperCase(),
  );
  if (!activeBodySnapshot || !orbitingBodySnapshot) return null;

  // Compute the anchor position (drei's Html accepts a [x, y, z] tuple).
  // Bodies with a non-1 positionScale (e.g. Moon) get the parent-relative scaling treatment.
  const positionScale = activeBodyProperties.positionScale ?? 1;
  let position: [number, number, number];
  if (positionScale !== 1) {
    const scaled: Vector3Simple = scaleDistance(
      activeBodySnapshot.position,
      orbitingBodySnapshot.position,
      positionScale,
    );
    position = [
      scaled.x / simulationScale.positionScale,
      scaled.y / simulationScale.positionScale,
      scaled.z / simulationScale.positionScale,
    ];
  } else {
    position = [
      activeBody.position.x / simulationScale.positionScale,
      activeBody.position.y / simulationScale.positionScale,
      activeBody.position.z / simulationScale.positionScale,
    ];
  }

  const distanceFromOrbitingBody = calculateDistance(
    activeBodySnapshot.position,
    orbitingBodySnapshot.position,
    "AU", // TODO make this dynamic for future
  );

  const velocityDelta: Vector3Simple = subtractVectors(
    activeBodySnapshot.velocity,
    orbitingBodySnapshot.velocity,
  );
  const relativeVelocity = calculateMagnitude(velocityDelta);

  // divider dimensions
  const diagonalLength: number = 20;
  const horizontalLength: number = 200;
  const totalWidth: number = diagonalLength + horizontalLength;
  const totalHeight: number = diagonalLength;

  return (
    <Html position={position} style={{ pointerEvents: "none" }}>
      <Box
        style={{
          position: "relative",
          width: totalWidth,
          height: totalHeight,
        }}
      >
        {/* SVG divider */}
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{ position: "absolute", left: 0, bottom: 0 }}
        >
          {/* Diagonal segment: from the anchor (bottom left) up to the start of the horizontal line */}
          <line
            x1="0"
            y1={totalHeight}
            x2={diagonalLength}
            y2={totalHeight - diagonalLength}
            stroke="white"
            strokeWidth="3"
          />
          {/* Horizontal segment: from end of the diagonal to the right */}
          <line
            x1={diagonalLength}
            y1={totalHeight - diagonalLength}
            x2={totalWidth}
            y2={totalHeight - diagonalLength}
            stroke="white"
            strokeWidth="6"
          />
        </svg>

        {/* Body name container: positioned above the horizontal line */}
        <Box
          style={{
            position: "absolute",
            left: diagonalLength * 1.5,
            bottom: totalHeight, // aligns with the horizontal line
            width: horizontalLength,
            textAlign: "left",
          }}
        >
          <Typography variant="h3"> {activeBody.name}</Typography>
        </Box>

        {/* Velocity info container: positioned below the horizontal line */}
        <Box
          style={{
            position: "absolute",
            left: diagonalLength * 1.5,
            top: totalHeight, // starts at the horizontal line
            width: horizontalLength,
            textAlign: "left",
          }}
        >
          <Typography variant="body2">
            {orbitingBodySnapshot?.name && (
              <>
                Distance to {toTitleCase(orbitingBodySnapshot.name)}:{" "}
                {distanceFromOrbitingBody}
              </>
            )}
          </Typography>
          <Typography variant="body2">
            Relative Velocity: {formatToKM(relativeVelocity)}
          </Typography>
        </Box>
      </Box>
    </Html>
  );
};

export default PlanetInfoOverlayActive;
