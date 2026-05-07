"use client";

import { Canvas } from "@react-three/fiber";
import Camera from "@/app/components/scene/Camera";
import Sphere from "@/app/components/scene/Sphere";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import SimConstants, { bodyProperties } from "@/app/constants/SimConstants";
import * as THREE from "three";
import {
  CelestialBody,
  CelestialBodyProperties,
  deleteExcessData,
  selectActiveBody,
  selectCelestialBodyPropertiesList,
  selectCurrentSimulationSnapshot,
  selectCurrentTimeStepIndex,
  selectIsBodyActive,
  selectIsPaused,
  selectShowAxes,
  selectShowGrid,
  selectShowPlanetInfoOverlay,
  selectSimulationScale,
  selectSpeedMultiplier,
  selectTimeStepKeys,
  setCurrentTimeStepIndex,
  setIsBodyActive,
  SimulationScale,
  updateActiveBody,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { useTheme } from "@mui/material/styles";
import PlanetInfoOverlayActive from "@/app/components/scene/PlanetInfoOverlayActive";

import { scaleDistance } from "@/app/utils/helpers";
import PlanetInfoOverlayAll from "@/app/components/scene/PlanetInfoOverlayAll";

const Scene = () => {
  const theme = useTheme();
  const showPlanetInfoOverlay = useSelector(selectShowPlanetInfoOverlay);
  const dispatch = useDispatch();
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const [celestialBodyRadiusMap, setCelestialBodyRadiusMap] = useState(
    new Map<string, number>(),
  );
  const simulationSnapshot: CelestialBody[] = useSelector(
    selectCurrentSimulationSnapshot,
  );
  const activeBody: CelestialBody | null = useSelector(selectActiveBody);

  //////// SIM PARAMS ////////
  const showGrid: boolean = useSelector(selectShowGrid);
  const showAxes: boolean = useSelector(selectShowAxes);
  const isPaused: boolean = useSelector(selectIsPaused);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const speedMultiplier: number = useSelector(selectSpeedMultiplier);
  const currentTimeStepIndex: number = useSelector(selectCurrentTimeStepIndex);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  const timeStepKeys = useSelector(selectTimeStepKeys);
  const totalTimeSteps: number = timeStepKeys.length;

  // get derived radii of bodies from initial radius constants and scale to simulation parameter
  useEffect(() => {
    if (
      !celestialBodyPropertiesList ||
      celestialBodyPropertiesList.length === 0
    )
      return;

    const celestialBodyRadiusMap = new Map<string, number>();

    for (const celestialBodyProperties of celestialBodyPropertiesList) {
      if (
        celestialBodyProperties.name &&
        celestialBodyProperties.radius !== undefined
      ) {
        celestialBodyRadiusMap.set(
          celestialBodyProperties.name,
          celestialBodyProperties.radius / simulationScale.radiusScale,
        );
      }
    }

    setCelestialBodyRadiusMap(celestialBodyRadiusMap);
  }, [celestialBodyPropertiesList, simulationScale]);

  // main rendering loop
  useEffect(() => {
    let lastTime = performance.now();
    let animationFrameId: number | null = null;

    const update = (time: number) => {
      checkDeleteExcessData();

      if (isBodyActive) {
        dispatch(updateActiveBody());
      }

      const deltaTime = time - lastTime;

      if (!isPaused && simulationSnapshot && totalTimeSteps > 0) {
        // update active body for UI rendering

        const stepsToMove = Math.abs(speedMultiplier);
        const direction = speedMultiplier > 0 ? 1 : -1;

        // update based on virtual FPS
        const timeStepInterval = 1000 / SimConstants.FPS;
        if (deltaTime >= timeStepInterval) {
          const nextIndex = Math.max(
            0,
            currentTimeStepIndex + direction * stepsToMove,
          );
          dispatch(setCurrentTimeStepIndex(nextIndex)); // Update Redux state
          lastTime = time;
        }
      }
      animationFrameId = requestAnimationFrame(update);
    };

    animationFrameId = requestAnimationFrame(update);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [
    simulationSnapshot,
    isPaused,
    speedMultiplier,
    currentTimeStepIndex,
    dispatch,
  ]);

  const checkDeleteExcessData = () => {
    if (timeStepKeys.length > SimConstants.MAX_TIMESTEPS) {
      const excessCount: number = SimConstants.TIMESTEP_CHUNK_SIZE;
      const payload = {
        excessCount: excessCount,
        timeStepKeys: timeStepKeys,
      };
      dispatch(deleteExcessData(payload));
    }
  };

  return (
    <Canvas
      onPointerMissed={(e: MouseEvent) => {
        dispatch(setIsBodyActive(false));
      }}
      style={{ width: "100%", height: "100%" }}
      onCreated={({ scene }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const context = canvas.getContext("2d");
        if (!context) return;

        const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, theme.canvas.canvasMain);
        gradient.addColorStop(0.5, theme.canvas.canvasGradientEdge);
        gradient.addColorStop(1, theme.canvas.canvasGradientEdge);

        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const numStars = 500;
        for (let i = 0; i < numStars; i++) {
          const x = Math.random() * canvas.width;
          const y = Math.random() * canvas.height;
          const minRadius = 0.05;
          const maxRadius = 0.1;
          const radius = minRadius + Math.random() * (maxRadius - minRadius);
          const opacity = 0.5 + Math.random() * 0.5;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
          context.fill();
        }

        scene.background = new THREE.CanvasTexture(canvas);
      }}
    >
      <Camera />
      <ambientLight intensity={Math.PI / 2} />
      {showAxes && <axesHelper args={[simulationScale.AXES.SIZE]} />}
      {showGrid && (
        <gridHelper
          args={[simulationScale.GRID.SIZE, simulationScale.GRID.SEGMENTS]}
        />
      )}
      {simulationSnapshot.map((body: CelestialBody) => {
        const radius: number = celestialBodyRadiusMap.get(body.name) ?? 1; // Default to 1 if not found
        let orbitingBody: CelestialBody | undefined;

        if (body.name.toUpperCase() === "SUN") {
          return (
            <React.Fragment key={body.name}>
              <pointLight
                key="sun-light"
                position={[body.position.x, body.position.y, body.position.z]}
                intensity={simulationScale.positionScale * 0.0001} // TODO adjust the intensity as needed
                distance={simulationScale.positionScale} // TODO adjust the distance so the light falls off
                // appropriately
                color={0xffffff} // typically white light for the sun
              />
              <Sphere
                key={body.name}
                name={body.name}
                body={body}
                position={[
                  body.position.x / simulationScale.positionScale,
                  body.position.y / simulationScale.positionScale,
                  body.position.z / simulationScale.positionScale,
                ]}
                radius={radius} // Pass radius to Sphere component
                textureUrl={
                  bodyProperties[body.name.toUpperCase()]?.texture.src ||
                  bodyProperties["FALLBACK"].texture.src // TODO use slice state
                }
              />
            </React.Fragment>
          );
        }

        // prepare orbitingBody if current body needs to be distance scaled
        // TODO orbitingBody is misleading. parentBody instead?
        const celestialBodyProperties = celestialBodyPropertiesList.find(
          (bp: CelestialBodyProperties) =>
            bp.name?.toUpperCase() === body.name.toUpperCase(),
        );
        if (!celestialBodyProperties) return null;

        const positionScale = celestialBodyProperties.positionScale ?? 1;
        const orbitingBodyName = celestialBodyProperties.orbitingBody;

        if (positionScale !== 1 && orbitingBodyName) {
          orbitingBody = simulationSnapshot.find(
            (b: CelestialBody) =>
              b.name.toUpperCase() === orbitingBodyName.toUpperCase(),
          );
        }

        const spherePosition: [number, number, number] = orbitingBody
          ? (() => {
              const scaled: Vector3Simple = scaleDistance(
                body.position,
                orbitingBody.position,
                positionScale,
              );
              return [
                scaled.x / simulationScale.positionScale,
                scaled.y / simulationScale.positionScale,
                scaled.z / simulationScale.positionScale,
              ];
            })()
          : [
              body.position.x / simulationScale.positionScale,
              body.position.y / simulationScale.positionScale,
              body.position.z / simulationScale.positionScale,
            ];

        return (
          <Sphere
            key={body.name}
            name={body.name}
            body={body}
            position={spherePosition}
            radius={radius} // Pass radius to Sphere component
            textureUrl={
              bodyProperties[body.name.toUpperCase()]?.texture.src ||
              bodyProperties["FALLBACK"].texture.src
            }
          />
        );
      })}
      <PlanetInfoOverlayActive />
      {/* Conditionally render overlays for all bodies except the active one */}
      {showPlanetInfoOverlay &&
        simulationSnapshot
          .filter(
            (body) =>
              body.name.trim().toUpperCase() !==
                activeBody?.name.trim().toUpperCase() || "",
          )
          .map((body) => <PlanetInfoOverlayAll key={body.name} body={body} />)}
      )
    </Canvas>
  );
};

export default Scene;
