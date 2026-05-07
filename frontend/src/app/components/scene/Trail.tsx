"use client";

import { useSelector } from "react-redux";
import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { RootState } from "@/app/store/Store";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepIndex,
  selectSimulationScale,
  selectTimeStepKeys,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { scaleDistance } from "@/app/utils/helpers";

interface TrailProps {
  bodyName: string;
  length?: number;
  color?: [number, number, number]; // RGB 0-1
}

const Trail: React.FC<TrailProps> = ({
  bodyName,
  length = 300,
  color = [1, 1, 1],
}) => {
  const simulationData = useSelector(
    (s: RootState) => s.simulation.simulationData,
  );
  const timeStepKeys = useSelector(selectTimeStepKeys);
  const currentTimeStepIndex = useSelector(selectCurrentTimeStepIndex);
  const simulationScale = useSelector(selectSimulationScale);
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );

  const { points, vertexColors } = useMemo(() => {
    if (
      !simulationData ||
      timeStepKeys.length === 0 ||
      currentTimeStepIndex < 1
    ) {
      return {
        points: [] as [number, number, number][],
        vertexColors: [] as [number, number, number, number][],
      };
    }

    const start = Math.max(0, currentTimeStepIndex - length);
    const end = currentTimeStepIndex;

    const bodyProps = celestialBodyPropertiesList.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === bodyName.toUpperCase(),
    );
    const positionScale = bodyProps?.positionScale ?? 1;
    const orbitingBodyName = bodyProps?.orbitingBody;

    const pts: [number, number, number][] = [];
    const cols: [number, number, number, number][] = [];
    const total = end - start;

    for (let i = start; i <= end; i++) {
      const key = timeStepKeys[i];
      const snapshot = simulationData[key];
      if (!snapshot) continue;
      const body = snapshot.find((b: CelestialBody) => b.name === bodyName);
      if (!body) continue;

      let pos: Vector3Simple = body.position;
      if (positionScale !== 1 && orbitingBodyName) {
        const orbiting = snapshot.find(
          (b: CelestialBody) =>
            b.name.toUpperCase() === orbitingBodyName.toUpperCase(),
        );
        if (orbiting) {
          pos = scaleDistance(body.position, orbiting.position, positionScale);
        }
      }

      pts.push([
        pos.x / simulationScale.positionScale,
        pos.y / simulationScale.positionScale,
        pos.z / simulationScale.positionScale,
      ]);

      // Alpha lerps from 0 (oldest) at tail to 1 (newest) at head
      const alpha = total > 0 ? (i - start) / total : 1;
      cols.push([color[0], color[1], color[2], alpha]);
    }

    return { points: pts, vertexColors: cols };
  }, [
    simulationData,
    timeStepKeys,
    currentTimeStepIndex,
    simulationScale,
    celestialBodyPropertiesList,
    bodyName,
    length,
    color,
  ]);

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      vertexColors={vertexColors}
      lineWidth={1}
      transparent
    />
  );
};

export default Trail;
