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

// Deep-space canvas background — inspired by the design handoff's
// `.starfield` recipe (frontend/design_handoff_spacesim_ui/index.html)
// but tuned for Canvas2D. The CSS uses `radial-gradient(ellipse at ...)`
// which auto-sizes to the container's farthest corner, producing very
// wide, diffuse ellipses. Canvas2D's createRadialGradient is strictly
// circular, so a literal port of the CSS values produces visible
// circular blobs rather than the intended atmospheric wash. We
// compensate by (a) making the radii ~1.4× the canvas (so each gradient
// extends well past the visible edges into a uniform tint) and (b)
// roughly halving the center alpha (since the same RGBA over a wider
// area is perceptually brighter at any given pixel).
//
// Base color is `--color-space` from globals.css. Hardcoded here because
// this texture is built inside R3F's onCreated callback before the
// document is attached; reading CSS vars at that moment is fragile.
const SPACE_BG_BASE = "#050610";
// Glow #1 — cool blue, top-right.
const GLOW1_X = 0.65;
const GLOW1_Y = 0.3;
const GLOW1_COLOR = "rgba(40, 60, 90, 0.16)";
// Glow #2 — dusky purple, bottom-left.
const GLOW2_X = 0.2;
const GLOW2_Y = 0.85;
const GLOW2_COLOR = "rgba(60, 30, 80, 0.10)";
// Both glows use the same outer radius — sized so the gradient extends
// past the canvas corners, avoiding any visible falloff edge.
const GLOW_OUTER_RADIUS_FRAC = 1.4;

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

        // 2. Layer the two nebula glows. Each glow is a wide circular
        //    radial gradient centered at the spec'd position with outer
        //    radius extending past the canvas edges, so the visible area
        //    sees only the inner / mid region of the falloff. Two soft
        //    color stops produce a smoother curve than a single linear
        //    one — closer to the CSS ellipse's perceptual gradient.
        const drawGlow = (fracX: number, fracY: number, color: string) => {
          const cx = fracX * canvas.width;
          const cy = fracY * canvas.height;
          const outerR = canvas.width * GLOW_OUTER_RADIUS_FRAC;
          const grad = context.createRadialGradient(cx, cy, 0, cx, cy, outerR);
          grad.addColorStop(0, color);
          // Mid-stop with reduced alpha makes the falloff curve gentler.
          grad.addColorStop(0.4, color.replace(/[\d.]+\)$/, "0.04)"));
          grad.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = grad;
          context.fillRect(0, 0, canvas.width, canvas.height);
        };
        drawGlow(GLOW1_X, GLOW1_Y, GLOW1_COLOR);
        drawGlow(GLOW2_X, GLOW2_Y, GLOW2_COLOR);

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

        const bgTexture = new THREE.CanvasTexture(canvas);
        // Canvas2D draws bytes in sRGB (browser default), but three.js's
        // CanvasTexture defaults to NoColorSpace (linear). Without this,
        // the renderer treats the sRGB bytes as already-linear and
        // re-encodes them through sRGB on output — double-encoded, so
        // #050610 lands on screen as roughly #28305b (visibly lifted /
        // washed out). Marking the texture sRGB tells three.js to
        // linearize on read and re-encode on write, preserving the drawn
        // color 1:1.
        bgTexture.colorSpace = THREE.SRGBColorSpace;
        scene.background = bgTexture;
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
