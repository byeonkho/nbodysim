"use client";

import { Canvas } from "@react-three/fiber";
import Camera from "@/app/components/scene/Camera";
import Sphere from "@/app/components/scene/Sphere";
import Trail from "@/app/components/scene/Trail";
import AnimationController from "@/app/components/scene/AnimationController";
import React, { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { bodyProperties } from "@/app/constants/SimConstants";
import * as THREE from "three";
import {
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectShowAxes,
  selectShowGrid,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
  setIsBodyActive,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import { useTheme } from "@mui/material/styles";
import { Reticle } from "@/app/components/scene/Reticle";
import { GhostLabel } from "@/app/components/scene/GhostLabel";
import { bodyColorRgb01, toBodyKey } from "@/app/constants/BodyVisuals";

const Scene = () => {
  const theme = useTheme();
  const showPlanetInfoOverlay = useSelector(selectShowPlanetInfoOverlay);
  const dispatch = useDispatch();
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const activeBodyName = useSelector(selectActiveBodyName);

  //////// SIM PARAMS ////////
  const showGrid: boolean = useSelector(selectShowGrid);
  const showAxes: boolean = useSelector(selectShowAxes);
  const showTrails: boolean = useSelector(selectShowTrails);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  // Per-body radius derived from current scale's radiusScale, indexed by name.
  // Stable across animation frames because both inputs are stable across
  // frames — only changes when celestialBodyPropertiesList or scale changes.
  const celestialBodyRadiusMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!celestialBodyPropertiesList) return map;
    for (const props of celestialBodyPropertiesList) {
      if (props.name && props.radius !== undefined) {
        map.set(props.name, props.radius / simulationScale.radiusScale);
      }
    }
    return map;
  }, [celestialBodyPropertiesList, simulationScale]);

  return (
    <Canvas
      onPointerMissed={() => {
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
      <Camera />
      <ambientLight intensity={Math.PI / 2} />
      {showAxes && <axesHelper args={[simulationScale.AXES.SIZE]} />}
      {showGrid && (
        <gridHelper
          args={[simulationScale.GRID.SIZE, simulationScale.GRID.SEGMENTS]}
        />
      )}
      {celestialBodyPropertiesList?.map((props: CelestialBodyProperties) => {
        if (!props.name) return null;
        const name = props.name;
        const radius: number = celestialBodyRadiusMap.get(name) ?? 1;
        const isSun = name.toUpperCase() === "SUN";
        const bodyKey = toBodyKey(name);
        const trailColor: [number, number, number] = bodyKey
          ? bodyColorRgb01(bodyKey)
          : [1, 1, 1];

        return (
          <React.Fragment key={name}>
            <Sphere
              name={name}
              radius={radius}
              textureUrl={
                bodyProperties[name.toUpperCase()]?.texture.src ||
                bodyProperties["FALLBACK"].texture.src
              }
              rotationSpeed={
                bodyProperties[name.toUpperCase()]?.rotationSpeed ?? 0.1
              }
              unlit={isSun}
            />
            {!isSun && showTrails && (
              <Trail bodyName={name} color={trailColor} />
            )}
          </React.Fragment>
        );
      })}
      <Reticle />
      {showPlanetInfoOverlay &&
        celestialBodyPropertiesList
          ?.filter(
            (props: CelestialBodyProperties) =>
              props.name &&
              props.name.trim().toUpperCase() !==
                (activeBodyName ?? "").trim().toUpperCase(),
          )
          .map((props: CelestialBodyProperties) => (
            <GhostLabel
              key={props.name}
              bodyName={props.name as string}
            />
          ))}
    </Canvas>
  );
};

export default Scene;
