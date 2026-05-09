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
import { Reticle } from "@/app/components/scene/Reticle";
import { GhostLabel } from "@/app/components/scene/GhostLabel";
import { bodyColorRgb01, toBodyKey } from "@/app/constants/BodyVisuals";

// Deep-space canvas background — matches the design handoff's `.starfield`
// CSS recipe (frontend/design_handoff_spacesim_ui/index.html). Inky blue
// base with two soft elliptical glows that read as distant nebulae /
// zodiacal light: cool blue top-right, dusky purple bottom-left. Fades
// over ~50% of each ellipse before going transparent.
//
// The base color is `--color-space` from globals.css (`#050610`); we
// don't read that from the DOM here because this canvas is built once
// at scene mount inside an onCreated callback, and reaching for CSS vars
// at that moment would couple us to the document tree the Three.js
// canvas isn't part of. Hardcoded; if globals.css's --color-space ever
// drifts, update this in lockstep.
const SPACE_BG_BASE = "#050610";
// Glow #1 — cool blue, top-right (60% x, 35% y in CSS coords; we map
// (0,0) to top-left, max to bottom-right of canvas, matching CSS).
const GLOW1_X = 0.6;
const GLOW1_Y = 0.35;
const GLOW1_COLOR = "rgba(40, 60, 90, 0.30)";
const GLOW1_FADE_END = 0.55; // gradient stops at 55% radius
// Glow #2 — dusky purple, bottom-left.
const GLOW2_X = 0.2;
const GLOW2_Y = 0.8;
const GLOW2_COLOR = "rgba(60, 30, 80, 0.18)";
const GLOW2_FADE_END = 0.5;

const Scene = () => {
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

        // 1. Fill the base inky-blue.
        context.fillStyle = SPACE_BG_BASE;
        context.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Layer the two nebula glows. Canvas2D's createRadialGradient
        //    takes (x0,y0,r0, x1,y1,r1) for two circles defining the
        //    gradient — we use a zero-radius inner circle (point source)
        //    and an outer circle sized to half the canvas so the fade
        //    spans the full visible area (ellipse approximation; canvas
        //    only supports circular gradients, but at 1024×1024 the
        //    visual difference from a true ellipse is negligible).
        const drawGlow = (
          fracX: number,
          fracY: number,
          color: string,
          fadeFrac: number,
        ) => {
          const cx = fracX * canvas.width;
          const cy = fracY * canvas.height;
          const outerR = (canvas.width / 2) * (fadeFrac / 0.5); // tune so 0.5 = half-canvas
          const grad = context.createRadialGradient(cx, cy, 0, cx, cy, outerR);
          grad.addColorStop(0, color);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = grad;
          context.fillRect(0, 0, canvas.width, canvas.height);
        };
        drawGlow(GLOW1_X, GLOW1_Y, GLOW1_COLOR, GLOW1_FADE_END);
        drawGlow(GLOW2_X, GLOW2_Y, GLOW2_COLOR, GLOW2_FADE_END);

        // 3. Procedural starfield on top of the glow.
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
      {/* Ambient kept very low so the night side reads as dark. The
          Sun's pointLight (in Sphere.tsx) does the heavy lifting; the
          half-Lambert wrap on lit bodies softens the terminator. */}
      <ambientLight intensity={0.05} />
      {/* Faint cool fill from above, even fainter warm tint from below.
          Fakes the negligible-but-non-zero starlight + zodiacal-light
          ambient that keeps deep-space surfaces from being pure void.
          Visible mostly as subtle silhouette detail on the dark side. */}
      <hemisphereLight args={[0xb0c4ff, 0x2a2118, 0.08]} />
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
