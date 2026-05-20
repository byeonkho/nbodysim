"use client";

import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { DoubleSide } from "three";
import Camera from "@/app/components/scene/Camera";
import Sphere from "@/app/components/scene/Sphere";
import Trail from "@/app/components/scene/Trail";
import OrbitPath from "@/app/components/scene/OrbitPath";
import AnimationController from "@/app/components/scene/AnimationController";
import { Skybox } from "@/app/components/scene/Skybox";
import React, { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import SimConstants, { bodyProperties } from "@/app/constants/SimConstants";
import {
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectShowAxes,
  selectShowGrid,
  selectShowOrbitPaths,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
  setIsBodyActive,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import { Reticle } from "@/app/components/scene/Reticle";
import { GhostLabel } from "@/app/components/scene/GhostLabel";
import { bodyColorRgb01, toBodyKey } from "@/app/constants/BodyVisuals";
import { worldDistance, worldRadius } from "@/app/utils/scalePipeline";

// Background is rendered in CSS on the parent container (Layout.tsx), not
// as a three.js scene.background. The canvas is transparent (`alpha: true`),
// so the design handoff's gradient stack — `radial-gradient(ellipse at ...)`
// pair over `#050610`, lifted verbatim from .starfield in the handoff
// HTML — shows through directly via the browser's CSS rendering. This
// sidesteps three.js's color pipeline entirely (no canvas-texture color
// space, no tone mapping concerns), and the visual is pixel-identical to
// the design mockup since the same browser renders both.
//
// Stars are now drei's <Stars /> — procedural Points cloud rendered by
// three.js on top of the transparent canvas, layered above the CSS bg.

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
  const showOrbitPaths: boolean = useSelector(selectShowOrbitPaths);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  // Per-body world radius via the scale pipeline, indexed by name.
  // Stable across animation frames because both inputs are stable across
  // frames — only changes when celestialBodyPropertiesList or scale changes.
  const celestialBodyRadiusMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!celestialBodyPropertiesList) return map;
    for (const props of celestialBodyPropertiesList) {
      if (props.name && props.radius !== undefined) {
        map.set(props.name, worldRadius(props.radius, simulationScale.preset));
      }
    }
    return map;
  }, [celestialBodyPropertiesList, simulationScale]);

  return (
    <Canvas
      // `flat` disables tone mapping (sets renderer.toneMapping =
      // NoToneMapping). R3F defaults to ACESFilmicToneMapping, which
      // is film-style midtone-lifting designed for HDR scenes — fights
      // a stylized palette where we want exact color match. With flat,
      // body materials render colors 1:1 from our half-Lambert wrap,
      // matching the look the lighting balance was tuned against.
      flat
      // Transparent canvas — the CSS background on Layout.tsx (the
      // design handoff's gradient stack) shows through. Without this,
      // the WebGL clear color (default opaque black) would hide the CSS.
      gl={{ alpha: true }}
      onPointerMissed={() => {
        dispatch(setIsBodyActive(false));
      }}
      style={{ width: "100%", height: "100%" }}
    >
      {/* NASA SVS Deep Star Maps 2020 mounted on scene.background — see
          Skybox.tsx for the why (drei <Stars/> twinkled on rotation due
          to point-primitive aliasing at our scene scale). */}
      <Skybox />

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
      {showGrid && (() => {
        // 1 cell = 1 AU, by construction. Major lines every 10 AU
        // (Jupiter sits ~5.2 AU; Neptune ~30 AU — so a 10 AU section
        // gives the user a meaningful "outer-system" landmark).
        // fadeDistance matches the camera's max-zoom-out cap so the
        // grid's visual horizon and the dolly wall line up.
        // args is intentionally [1, 1] (drei default): with infiniteGrid
        // the vertex shader scales the plane internally by (1 + fadeDistance),
        // so passing larger args double-applies the scaling — at our
        // zoom-out fadeDistance (~90k wu) that pushes vertex worldPosition
        // to ~8 billion wu, where float32 has ~0 decimal digits of
        // precision and per-fragment derivatives become nondeterministic
        // noise (visible as the grid shaking on any camera motion).
        const auInWu = worldDistance(SimConstants.AU_M, simulationScale.preset);
        const fadeDistance = Math.min(
          simulationScale.AXES.SIZE * SimConstants.CAMERA_MAX_DISTANCE_MULTIPLIER,
          SimConstants.STARS_RADIUS * 0.9,
        );
        return (
          <Grid
            args={[1, 1]}
            cellSize={auInWu}
            cellThickness={0.6}
            cellColor="#3a3f4d"
            sectionSize={auInWu * 10}
            sectionThickness={1}
            sectionColor="#5a607a"
            fadeDistance={fadeDistance}
            fadeStrength={1.2}
            infiniteGrid
            side={DoubleSide}
          />
        );
      })()}
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
            {!isSun && showOrbitPaths && (
              <OrbitPath bodyName={name} color={trailColor} />
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
