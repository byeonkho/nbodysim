"use client";

import { Canvas } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
import Camera from "@/app/components/scene/Camera";
import Sphere from "@/app/components/scene/Sphere";
import Trail from "@/app/components/scene/Trail";
import AnimationController from "@/app/components/scene/AnimationController";
import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { bodyProperties } from "@/app/constants/SimConstants";
import * as THREE from "three";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBody,
  selectCelestialBodyPropertiesList,
  selectCurrentSimulationSnapshot,
  selectShowAxes,
  selectShowGrid,
  selectShowPlanetInfoOverlay,
  selectSimulationScale,
  setIsBodyActive,
  SimulationScale,
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
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

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
      <AnimationController />
      {process.env.NODE_ENV === "development" && <Stats />}
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
                radius={radius}
                textureUrl={
                  bodyProperties[body.name.toUpperCase()]?.texture.src ||
                  bodyProperties["FALLBACK"].texture.src // TODO use slice state
                }
                rotationSpeed={bodyProperties[body.name.toUpperCase()]?.rotationSpeed ?? 0.1}
                unlit
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
          <React.Fragment key={body.name}>
            <Sphere
              name={body.name}
              body={body}
              position={spherePosition}
              radius={radius}
              textureUrl={
                bodyProperties[body.name.toUpperCase()]?.texture.src ||
                bodyProperties["FALLBACK"].texture.src
              }
              rotationSpeed={bodyProperties[body.name.toUpperCase()]?.rotationSpeed ?? 0.1}
            />
            <Trail bodyName={body.name} />
          </React.Fragment>
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
