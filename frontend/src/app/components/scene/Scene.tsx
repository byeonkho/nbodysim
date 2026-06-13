"use client";

import { Canvas } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { DoubleSide } from "three";
import Camera from "@/app/components/scene/Camera";
import Sphere from "@/app/components/scene/Sphere";
import Trail from "@/app/components/scene/Trail";
import OrbitPath from "@/app/components/scene/OrbitPath";
import MoonSystemRing from "@/app/components/scene/MoonSystemRing";
import AnimationController from "@/app/components/scene/AnimationController";
import { Skybox } from "@/app/components/scene/Skybox";
import React, { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import SimConstants, { bodyProperties } from "@/app/constants/SimConstants";
import {
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  selectShowAxes,
  selectShowGrid,
  selectShowOrbitPaths,
  selectShowPlanetInfoOverlay,
  selectShowTrails,
  selectSimulationScale,
  setIsBodyActive,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import {
  isGatedMoonParent,
  isMoonParentCollapsed,
  shouldShowMoonDetail,
} from "@/app/constants/BodyCatalog";
import { Reticle } from "@/app/components/scene/Reticle";
import { GhostLabel } from "@/app/components/scene/GhostLabel";
import DriftOverlay from "@/app/components/scene/DriftOverlay";
import { selectOverlayEnabled } from "@/app/store/slices/GroundTruthSlice";
import { bodyColorRgb01, toBodyKey } from "@/app/constants/BodyVisuals";
import { worldDistance, worldRadius } from "@/app/utils/scalePipeline";
import { useDevSettings } from "@/app/dev/devSettingsStore";

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
  const driftOverlayEnabled = useSelector(selectOverlayEnabled);
  const dispatch = useDispatch();
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);

  //////// SIM PARAMS ////////
  const showGrid: boolean = useSelector(selectShowGrid);
  const showAxes: boolean = useSelector(selectShowAxes);
  const showTrails: boolean = useSelector(selectShowTrails);
  const showOrbitPaths: boolean = useSelector(selectShowOrbitPaths);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);

  // Subscribe to dev settings so the radius map re-computes when Log-preset
  // tunables (specifically logRadiusExponent) change. worldRadius reads from
  // devSettings internally; without this subscription the useMemo below
  // doesn't know to invalidate when the dev slider moves.
  const devSettings = useDevSettings();

  // Per-body world radius via the scale pipeline, indexed by name.
  // Re-computes when celestialBodyPropertiesList, the active preset, or any
  // Log-preset tunable changes (body-radius exponent + minimum-radius floor).
  // worldRadius reads both from devSettings internally; the explicit deps
  // below are the invalidation triggers for slider drags. ESLint's static
  // analysis can't see through to the devSettings reads inside worldRadius,
  // hence the disable.
  const celestialBodyRadiusMap = useMemo(
    () => {
      const map = new Map<string, number>();
      if (!celestialBodyPropertiesList) return map;
      for (const props of celestialBodyPropertiesList) {
        if (props.name && props.radius !== undefined) {
          map.set(
            props.name,
            worldRadius(props.radius, simulationScale.preset),
          );
        }
      }
      return map;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      celestialBodyPropertiesList,
      simulationScale,
      devSettings.logRadiusExponent,
      devSettings.logMinRadius,
    ],
  );

  // Uppercased focused body, or null when nothing is actively selected
  // (deselect leaves activeBodyName set but isBodyActive false → treat as no
  // focus, so every moon system collapses). Scene re-renders only on selector
  // changes, not per frame, so this render-time work is fine.
  const activeUpper = isBodyActive
    ? activeBodyName?.trim().toUpperCase() ?? null
    : null;

  // Count of each gated parent's moons present in the current sim. Drives the
  // collapsed-state "☾N" chip. Rebuilds only when the body list changes.
  const moonCountByParent = useMemo(() => {
    const m = new Map<string, number>();
    if (!celestialBodyPropertiesList) return m;
    for (const props of celestialBodyPropertiesList) {
      const parent = props.orbitingBody?.trim().toUpperCase();
      if (parent && isGatedMoonParent(parent)) {
        m.set(parent, (m.get(parent) ?? 0) + 1);
      }
    }
    return m;
  }, [celestialBodyPropertiesList]);

  // Stable per-parent ring colors. bodyColorRgb01 returns a fresh array each
  // call, so computing it inline in the render map would hand MoonSystemRing a
  // new `color` identity every Scene re-render (selection / toggle changes),
  // rebuilding its geometry + material each time. Memoizing here keeps the
  // array identities stable as long as the parent set is stable.
  const moonRingColors = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    for (const parentUpper of moonCountByParent.keys()) {
      const key = toBodyKey(parentUpper);
      m.set(parentUpper, key ? bodyColorRgb01(key) : [0.7, 0.7, 0.7]);
    }
    return m;
  }, [moonCountByParent]);

  // Stable per-body trail/orbit colors. bodyColorRgb01 returns a fresh array
  // each call, so computing it inline in the body map would hand OrbitPath a
  // new `color` identity every Scene re-render (selection / toggle / scale
  // change), rebuilding its geometry + material each time (~30 instances).
  // Memoizing here keeps the array identities stable across re-renders. Same
  // pattern as moonRingColors above; Trail is unaffected (its geometry memo has
  // no color dep) but reads from here too for consistency.
  const bodyColors = useMemo(() => {
    const m = new Map<string, [number, number, number]>();
    if (!celestialBodyPropertiesList) return m;
    for (const props of celestialBodyPropertiesList) {
      if (!props.name) continue;
      const key = toBodyKey(props.name);
      if (key) m.set(props.name, bodyColorRgb01(key));
    }
    return m;
  }, [celestialBodyPropertiesList]);

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
      // preserveDrawingBuffer only under e2e: headless Chromium clears the
      // WebGL buffer after compositing, so a Playwright readPixels grab comes
      // back blank without it. Off in production (it carries a small perf cost).
      gl={{ alpha: true, preserveDrawingBuffer: process.env.NEXT_PUBLIC_E2E === "1" }}
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
      {/* Grid only renders in Real preset. Its "1 cell = 1 AU" semantics
          rely on linear distance scaling. In Stylized preset world distance
          is log1p-compressed, so a uniform Cartesian grid would silently
          lie (Neptune at 30 AU sits at world cell ~5, not cell 30). Hiding
          the grid there is the honest call. The toggle stays interactive
          so users can pre-set their preference before flipping to Real. */}
      {showGrid && simulationScale.preset === "realistic" && (() => {
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
        const trailColor: [number, number, number] =
          bodyColors.get(name) ?? [1, 1, 1];

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
      {[...moonCountByParent.keys()].map((parentUpper) => (
        <MoonSystemRing
          key={parentUpper}
          parentName={parentUpper}
          color={moonRingColors.get(parentUpper) ?? [0.7, 0.7, 0.7]}
        />
      ))}
      <Reticle />
      {driftOverlayEnabled && <DriftOverlay />}
      {showPlanetInfoOverlay &&
        celestialBodyPropertiesList
          ?.filter(
            // Exclude only the *actively* focused body (it shows in the
            // inspector instead). Keyed on activeUpper, not raw activeBodyName,
            // so deselect (isBodyActive false, activeBodyName persists) brings
            // the body's own label back — same focus signal the moon gating
            // below uses, so the two never disagree.
            (props: CelestialBodyProperties) =>
              props.name && props.name.trim().toUpperCase() !== activeUpper,
          )
          .map((props: CelestialBodyProperties) => {
            const upper = (props.name as string).trim().toUpperCase();
            const parentUpper = props.orbitingBody?.trim().toUpperCase() ?? null;
            // Drop a collapsed moon's label entirely (unmounts its <Html>).
            if (!shouldShowMoonDetail(parentUpper, activeUpper)) return null;
            // Collapsed gated parent gets the aggregate "☾N" chip.
            const moonCount = isMoonParentCollapsed(upper, activeUpper)
              ? moonCountByParent.get(upper) ?? 0
              : 0;
            return (
              <GhostLabel
                key={props.name}
                bodyName={props.name as string}
                moonCount={moonCount > 0 ? moonCount : undefined}
              />
            );
          })}
    </Canvas>
  );
};

export default Scene;
