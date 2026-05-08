# Scene re-render cascade fix (todo #52) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the per-frame React re-render cascade triggered by `setCurrentTimeStepIndex` so the simulation can grow more visual features (Saturn rings, atmospheric halos, hover tooltips) without compounding per-frame React work.

**Architecture:** All scene-graph components that need per-frame position updates (Sphere, Camera tracking, PlanetInfoOverlayActive/All) switch to the imperative pattern already established by `Trail.tsx`: subscribe-once via `useStore<RootState>()`, read state inside `useFrame` via `store.getState()`, mutate `meshRef.current.position` / `groupRef.current.position` in place. The Redux state shape changes too: `activeBodyState.activeBody: CelestialBody` is replaced with `activeBodyName: string | null` (consumers derive the live snapshot imperatively), eliminating the per-frame `dispatch(updateActiveBody())`. Once all consumers are off it, the per-frame `dispatch(setCurrentSimulationSnapshot(...))` and the `simulationSetSnapshotMiddleware` are deleted, along with the `currentSimulationSnapshot` slice field.

**Tech Stack:** React 19, React Three Fiber 9, drei 10, Redux Toolkit, TypeScript 6, three.js.

**Reference:** `~/.claude/projects/-Users-byeonkho-code-spacesim/memory/engineering_patterns_spacesim.md` — hot-path classification rules. This plan codifies the "don't subscribe to Redux for per-frame reads" rule across the scene graph.

**Verification baseline:** before starting, run `cd frontend && npm run build` and `npm test` to confirm a clean baseline. After each task, run `npx tsc --noEmit` for fast type feedback. The full canonical check at the end is `npm run build`.

---

## File Structure

Files modified:
- `frontend/src/app/store/slices/SimulationSlice.ts` — state shape change, drop `updateActiveBody` reducer + `setCurrentSimulationSnapshot` reducer + `simulationSetSnapshotMiddleware`, drop `currentSimulationSnapshot` field, update selectors.
- `frontend/src/app/store/Store.ts` — drop `simulationSetSnapshotMiddleware` from middleware chain.
- `frontend/src/app/components/scene/Scene.tsx` — iterate over `celestialBodyPropertiesList` (static body identity list) instead of the per-frame `simulationSnapshot`. Sphere is now structural; positions live inside Sphere.
- `frontend/src/app/components/scene/Sphere.tsx` — imperative position via `useFrame` + `useStore`. Sun's `pointLight` absorbed into Sphere (rendered as a child when `unlit`). New prop signature: `name`, `radius`, `textureUrl`, `rotationSpeed`, `unlit` only.
- `frontend/src/app/components/scene/AnimationController.tsx` — drop `dispatch(updateActiveBody())` per frame; the reducer goes away too.
- `frontend/src/app/components/scene/Camera.tsx` — drop `selectActiveBody` subscription. Read active body name once, look up live snapshot inside `useFrame`.
- `frontend/src/app/components/scene/PlanetInfoOverlayActive.tsx` — wrap drei `<Html>` in our own `<group>` so we can mutate world position imperatively. Subscribe to `activeBodyName` (changes only on click). Update text values (distance, velocity) via DOM refs inside `useFrame`.
- `frontend/src/app/components/scene/PlanetInfoOverlayAll.tsx` — same imperative wrapper-group pattern. No text updates needed (just renders body name once).
- `frontend/src/app/components/interface/misc/BodySelector.tsx` — switch from `currentSimulationSnapshot` to `celestialBodyPropertiesList` for the list of bodies; dispatch active body by name.
- `frontend/src/app/components/interface/drawer/components/InfoOverview.tsx` — debug panel, polls live snapshot via `setInterval` with local `useState` instead of subscribing to per-frame Redux.

Files unchanged but worth flagging:
- `frontend/src/app/components/scene/Trail.tsx` — already imperative; no change needed. Reference implementation for the new pattern.

---

## Task 1: Add `activeBodyName` to state (additive)

The plan introduces `activeBodyName` first as an additive change (build keeps passing, no consumers wired up yet). Removal of the old `activeBody` field happens in the final cleanup task once all consumers are migrated.

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`

- [ ] **Step 1: Add `activeBodyName` to `ActiveBodyState` type**

In `SimulationSlice.ts:48-51` change `ActiveBodyState`:

```ts
interface ActiveBodyState {
  isBodyActive: boolean;
  activeBody: CelestialBody | null;
  activeBodyName: string | null;
}
```

- [ ] **Step 2: Initialize the new field**

In `SimulationSlice.ts:93-96`:

```ts
activeBodyState: {
  isBodyActive: false,
  activeBody: null,
  activeBodyName: null,
},
```

- [ ] **Step 3: Update `setActiveBody` reducer to write both fields**

The old reducer accepts a `CelestialBody` and stores it. Make it also store the name:

```ts
setActiveBody: (
  state: SimulationState,
  action: PayloadAction<CelestialBody>,
) => {
  state.activeBodyState.activeBody = action.payload;
  state.activeBodyState.activeBodyName = action.payload.name;
  state.activeBodyState.isBodyActive = true;
},
```

(Both fields written for now so existing consumers keep working. Old `activeBody` field is removed in Task 9.)

- [ ] **Step 4: Add `selectActiveBodyName` selector**

After `selectActiveBody` in `SimulationSlice.ts:504`:

```ts
export const selectActiveBodyName = (state: RootState) =>
  state.simulation.activeBodyState.activeBodyName;
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (additive change, no existing code references the new field).

Run: `cd frontend && npm run build`
Expected: PASS.

---

## Task 2: Sphere goes imperative + Scene goes structural

These two changes are tightly coupled (Sphere's prop signature changes; Scene must update at the same time). Done together.

**Files:**
- Modify: `frontend/src/app/components/scene/Sphere.tsx`
- Modify: `frontend/src/app/components/scene/Scene.tsx`

- [ ] **Step 1: Rewrite `Sphere.tsx` to read its position imperatively**

Replace the entire file content with:

```tsx
import { useFrame, useLoader } from "@react-three/fiber";
import React, { useRef } from "react";
import { useDispatch, useStore } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import {
  CelestialBody,
  CelestialBodyProperties,
  setActiveBody,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { scaleDistance } from "@/app/utils/helpers";
import * as THREE from "three";

interface SphereProps {
  name: string;
  radius: number;
  textureUrl?: string;
  rotationSpeed?: number;
  unlit?: boolean;
}

/**
 * Renders one celestial body. Position updates imperatively inside useFrame
 * by reading the live snapshot from Redux via store.getState() — never
 * subscribes per frame, so React reconciliation only fires on identity /
 * scale changes (texture, radius), not on every animation tick.
 *
 * When `unlit` is true (the Sun), a pointLight is rendered as a child mesh
 * so the light tracks the same imperative position update as the sphere.
 */
const Sphere: React.FC<SphereProps> = ({
  name,
  radius,
  textureUrl,
  rotationSpeed = 0.1,
  unlit = false,
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.PointLight>(null!);
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();

  // useLoader's TextureLoader signature is awkward in current type stack;
  // cast is the conventional escape.
  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  useFrame((_, delta) => {
    // Position from live snapshot (imperative read).
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const propsList =
      state.simulation.simulationParameters.celestialBodyPropertiesList;

    if (simulationData && currentTimeStepKey) {
      const snapshot = simulationData[currentTimeStepKey];
      if (snapshot) {
        const body = snapshot.find((b: CelestialBody) => b.name === name);
        if (body) {
          const bodyProps: CelestialBodyProperties | undefined = propsList.find(
            (bp: CelestialBodyProperties) =>
              bp.name?.toUpperCase() === name.toUpperCase(),
          );
          const positionScale = bodyProps?.positionScale ?? 1;
          const orbitingBodyName = bodyProps?.orbitingBody;

          let pos: Vector3Simple = body.position;
          if (positionScale !== 1 && orbitingBodyName) {
            const orbiting = snapshot.find(
              (b: CelestialBody) =>
                b.name.toUpperCase() === orbitingBodyName.toUpperCase(),
            );
            if (orbiting) {
              pos = scaleDistance(
                body.position,
                orbiting.position,
                positionScale,
              );
            }
          }

          const x = pos.x / simulationScale.positionScale;
          const y = pos.y / simulationScale.positionScale;
          const z = pos.z / simulationScale.positionScale;
          meshRef.current.position.set(x, y, z);
          if (lightRef.current) {
            lightRef.current.position.set(x, y, z);
            lightRef.current.intensity = simulationScale.positionScale * 0.0001;
            lightRef.current.distance = simulationScale.positionScale;
          }
        }
      }
    }

    // Spin (visual only — wall-clock based).
    meshRef.current.rotation.y += rotationSpeed * delta;
  });

  // Click handler dispatches the live snapshot for the click moment.
  // setActiveBody currently writes both the body and its name; later the
  // payload narrows to a name string in Task 9.
  const handleClick = () => {
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;
    const body = snapshot.find((b: CelestialBody) => b.name === name);
    if (body) dispatch(setActiveBody(body));
  };

  return (
    <>
      <mesh ref={meshRef} onClick={handleClick}>
        <sphereGeometry args={[radius, 32, 32]} />
        {unlit ? (
          <meshBasicMaterial map={textureUrl ? texture : undefined} />
        ) : (
          <meshStandardMaterial map={textureUrl ? texture : undefined} />
        )}
      </mesh>
      {unlit && <pointLight ref={lightRef} color={0xffffff} />}
    </>
  );
};

export default Sphere;
```

- [ ] **Step 2: Rewrite `Scene.tsx` to iterate `celestialBodyPropertiesList`**

The Scene becomes structural: it determines which bodies exist (by name) and renders one Sphere + Trail per body. Position handling moves entirely into Sphere/Trail.

Replace `Scene.tsx` content with:

```tsx
"use client";

import { Canvas } from "@react-three/fiber";
import { Stats } from "@react-three/drei";
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
import PlanetInfoOverlayActive from "@/app/components/scene/PlanetInfoOverlayActive";
import PlanetInfoOverlayAll from "@/app/components/scene/PlanetInfoOverlayAll";

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
      {process.env.NODE_ENV === "development" && <Stats />}
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
            {!isSun && showTrails && <Trail bodyName={name} />}
          </React.Fragment>
        );
      })}
      <PlanetInfoOverlayActive />
      {showPlanetInfoOverlay &&
        celestialBodyPropertiesList
          ?.filter(
            (props) =>
              props.name &&
              props.name.trim().toUpperCase() !==
                (activeBodyName ?? "").trim().toUpperCase(),
          )
          .map((props) => (
            <PlanetInfoOverlayAll
              key={props.name}
              bodyName={props.name as string}
            />
          ))}
    </Canvas>
  );
};

export default Scene;
```

Note: `PlanetInfoOverlayAll` now takes `bodyName: string` instead of `body: CelestialBody`. That change is implemented in Task 6.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: type errors only in `PlanetInfoOverlayAll.tsx` (its prop signature is about to change in Task 6). Other files should pass.

Note: the build will not be fully clean until Task 6 lands. That is OK — type errors localized to one file are an expected intermediate state.

---

## Task 3: Camera reads active body imperatively

**Files:**
- Modify: `frontend/src/app/components/scene/Camera.tsx`

- [ ] **Step 1: Rewrite Camera to read active body name + imperative position**

Replace the relevant sections of `Camera.tsx`. The `useFrame` callback now reads the live snapshot via `store.getState()` instead of `selectActiveBody`. The `radius` derivation also uses the name (not the full body object).

Full replacement file:

```tsx
import React, { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBodyName,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
} from "@/app/store/slices/SimulationSlice";
import * as THREE from "three";
import { RootState } from "@/app/store/Store";
import {
  getDevSettings,
  useDevSettings,
} from "@/app/dev/devSettingsStore";

const Camera: React.FC = () => {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null!);
  const activeBodyName: string | null = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const { orbitDampingFactor } = useDevSettings();
  const store = useStore<RootState>();

  // Active body's radius scaled by the current simulationScale.
  // Pulled imperatively from the props list; only re-derived on identity change.
  const activeRadius = (() => {
    if (!activeBodyName || !isBodyActive) return undefined;
    const propsList =
      store.getState().simulation.simulationParameters
        .celestialBodyPropertiesList;
    const bodyProps = propsList.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === activeBodyName.toUpperCase(),
    );
    return bodyProps?.radius;
  })();
  const radius = (activeRadius ?? 1) / simulationScale.radiusScale;

  const trackingZoomRef = useRef<number>(radius);

  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    camera.near = 0.1;
    camera.far = 1e12;
    camera.updateProjectionMatrix();
  }, [camera]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (!controlsRef.current) return;
    const D = simulationScale.AXES.SIZE;
    camera.position.set(0, D * 0.15, D * 0.3);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
    trackingZoomRef.current = D * 0.3;
  }, [camera, simulationScale]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoomSensitivity } = getDevSettings();
      trackingZoomRef.current *= 1 + e.deltaY * zoomSensitivity;
      trackingZoomRef.current = THREE.MathUtils.clamp(
        trackingZoomRef.current,
        0.00001,
        1e20,
      );
    };

    gl.domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      gl.domElement.removeEventListener("wheel", onWheel);
    };
  }, [gl.domElement]);

  // Reuse one Vector3 across frames — no per-frame allocation.
  const targetScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (isBodyActive && activeBodyName) {
      // Read the live snapshot for the active body imperatively.
      const state = store.getState();
      const simulationData = state.simulation.simulationData;
      const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
      const scale = state.simulation.simulationParameters.simulationScale;

      if (simulationData && currentTimeStepKey) {
        const snapshot = simulationData[currentTimeStepKey];
        const body = snapshot?.find(
          (b: CelestialBody) => b.name === activeBodyName,
        );
        if (body) {
          targetScratch.current.set(
            body.position.x / scale.positionScale,
            body.position.y / scale.positionScale,
            body.position.z / scale.positionScale,
          );
          controlsRef.current.target.lerp(targetScratch.current, 0.01);

          const offset = camera.position
            .clone()
            .sub(controlsRef.current.target);
          const currentRadius = offset.length();
          if (currentRadius > 0) offset.divideScalar(currentRadius);

          const { cameraZoomLerpRate } = getDevSettings();
          const newRadius = THREE.MathUtils.lerp(
            currentRadius,
            trackingZoomRef.current,
            cameraZoomLerpRate,
          );

          camera.position
            .copy(controlsRef.current.target)
            .addScaledVector(offset, newRadius);
        }
      }
    }
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={orbitDampingFactor}
      enableZoom={!isBodyActive}
    />
  );
};

export default Camera;
```

Note on the `offset.clone()` and per-frame `.sub()`: these are minor allocations identified in `engineering_patterns_spacesim.md` as known existing offenders. We are intentionally **not** fixing them in this task — the scope is the cascade fix, not Camera's internal allocation pattern. They can be addressed in a follow-up if profiling shows they matter.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: same intermediate state as Task 2 — `PlanetInfoOverlayAll.tsx` errors persist; `Camera.tsx` should now type-check cleanly.

---

## Task 4: PlanetInfoOverlayActive imperative

The overlay renders 2D HTML positioned at a 3D point via drei's `<Html>`. To update the anchor without re-rendering, we wrap `<Html>` in our own `<group>` and mutate the group's position in `useFrame`. Inside the HTML, distance and velocity values are mutated via DOM refs (`textContent` writes — no React re-render).

Subscriptions: `activeBodyName` (changes only on click), `isBodyActive` (changes only on click), `celestialBodyPropertiesList` (only changes on scale toggle / sim load), `simulationScale` (only changes on scale toggle). None fire per frame.

**Files:**
- Modify: `frontend/src/app/components/scene/PlanetInfoOverlayActive.tsx`

- [ ] **Step 1: Rewrite PlanetInfoOverlayActive**

Replace file content with:

```tsx
import React, { useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectIsBodyActive,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { RootState } from "@/app/store/Store";

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
import * as THREE from "three";

const PlanetInfoOverlayActive = () => {
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive: boolean = useSelector(selectIsBodyActive);
  const celestialBodyPropertiesList: CelestialBodyProperties[] = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const distanceRef = useRef<HTMLSpanElement>(null);
  const velocityRef = useRef<HTMLSpanElement>(null);

  // Resolve the active body's properties + parent body name once per
  // identity / scale change (NOT per frame). These are stable inputs to
  // the imperative position calculation in useFrame.
  const activeProps: CelestialBodyProperties | null = (() => {
    if (!activeBodyName) return null;
    const upper = activeBodyName.trim().toUpperCase();
    return (
      celestialBodyPropertiesList.find(
        (p) => p.name?.trim().toUpperCase() === upper,
      ) ?? null
    );
  })();

  // Update text contents lazily — they only change perceptibly every few frames.
  // Throttle by dropping writes when the new formatted string equals the last one.
  const lastDistance = useRef<string>("");
  const lastVelocity = useRef<string>("");

  useFrame(() => {
    if (!isBodyActive || !activeBodyName || !activeProps || !groupRef.current)
      return;

    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;

    const upperName = activeBodyName.trim().toUpperCase();
    const activeBody = snapshot.find(
      (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
    );
    if (!activeBody) return;

    const orbitingName = activeProps.orbitingBody;
    const orbitingBody = orbitingName
      ? snapshot.find(
          (b: CelestialBody) =>
            b.name.trim().toUpperCase() === orbitingName.trim().toUpperCase(),
        )
      : undefined;
    if (!orbitingBody) return;

    // Anchor position (apply scaleDistance for non-1 positionScale bodies).
    const positionScale = activeProps.positionScale ?? 1;
    let pos: Vector3Simple = activeBody.position;
    if (positionScale !== 1) {
      pos = scaleDistance(activeBody.position, orbitingBody.position, positionScale);
    }
    groupRef.current.position.set(
      pos.x / simulationScale.positionScale,
      pos.y / simulationScale.positionScale,
      pos.z / simulationScale.positionScale,
    );

    // Update displayed distance + velocity values via DOM refs (no React re-render).
    const distance = calculateDistance(
      activeBody.position,
      orbitingBody.position,
      "AU",
    );
    if (distance !== lastDistance.current && distanceRef.current) {
      distanceRef.current.textContent = distance;
      lastDistance.current = distance;
    }

    const velocityDelta: Vector3Simple = subtractVectors(
      activeBody.velocity,
      orbitingBody.velocity,
    );
    const relativeVelocity = formatToKM(calculateMagnitude(velocityDelta));
    if (relativeVelocity !== lastVelocity.current && velocityRef.current) {
      velocityRef.current.textContent = relativeVelocity;
      lastVelocity.current = relativeVelocity;
    }
  });

  // Reset the text caches when the active body changes so the new body's
  // values get written at least once on the first frame.
  useEffect(() => {
    lastDistance.current = "";
    lastVelocity.current = "";
  }, [activeBodyName]);

  if (!activeBodyName || !isBodyActive || !activeProps) return null;
  const orbitingName = activeProps.orbitingBody;
  if (!orbitingName) return null;

  // divider dimensions
  const diagonalLength: number = 20;
  const horizontalLength: number = 200;
  const totalWidth: number = diagonalLength + horizontalLength;
  const totalHeight: number = diagonalLength;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <Box
          style={{
            position: "relative",
            width: totalWidth,
            height: totalHeight,
          }}
        >
          <svg
            width={totalWidth}
            height={totalHeight}
            style={{ position: "absolute", left: 0, bottom: 0 }}
          >
            <line
              x1="0"
              y1={totalHeight}
              x2={diagonalLength}
              y2={totalHeight - diagonalLength}
              stroke="white"
              strokeWidth="3"
            />
            <line
              x1={diagonalLength}
              y1={totalHeight - diagonalLength}
              x2={totalWidth}
              y2={totalHeight - diagonalLength}
              stroke="white"
              strokeWidth="6"
            />
          </svg>

          <Box
            style={{
              position: "absolute",
              left: diagonalLength * 1.5,
              bottom: totalHeight,
              width: horizontalLength,
              textAlign: "left",
            }}
          >
            <Typography variant="h3"> {activeBodyName}</Typography>
          </Box>

          <Box
            style={{
              position: "absolute",
              left: diagonalLength * 1.5,
              top: totalHeight,
              width: horizontalLength,
              textAlign: "left",
            }}
          >
            <Typography variant="body2">
              Distance to {toTitleCase(orbitingName)}:{" "}
              <span ref={distanceRef}></span>
            </Typography>
            <Typography variant="body2">
              Relative Velocity: <span ref={velocityRef}></span>
            </Typography>
          </Box>
        </Box>
      </Html>
    </group>
  );
};

export default PlanetInfoOverlayActive;
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: same intermediate state — `PlanetInfoOverlayAll.tsx` still errors; this file should pass.

---

## Task 5: PlanetInfoOverlayAll imperative

Same imperative-wrapper-group pattern as Task 4, but simpler: only the position is per-frame; the displayed text (body name) is static per instance.

**Files:**
- Modify: `frontend/src/app/components/scene/PlanetInfoOverlayAll.tsx`

- [ ] **Step 1: Rewrite PlanetInfoOverlayAll**

Replace file content with:

```tsx
import React, { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectSimulationScale,
  SimulationScale,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { RootState } from "@/app/store/Store";
import { scaleDistance } from "@/app/utils/helpers";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import * as THREE from "three";

interface PlanetInfoOverlayAllProps {
  bodyName: string;
}

const PlanetInfoOverlayAll: React.FC<PlanetInfoOverlayAllProps> = ({
  bodyName,
}) => {
  const simulationScale: SimulationScale = useSelector(selectSimulationScale);
  const celestialBodyPropertiesList = useSelector(
    selectCelestialBodyPropertiesList,
  );
  const store = useStore<RootState>();
  const groupRef = useRef<THREE.Group>(null!);

  // Resolve properties once per identity / scale change.
  const upperName = bodyName.trim().toUpperCase();
  const properties: CelestialBodyProperties | undefined =
    celestialBodyPropertiesList?.find(
      (p) => p.name?.trim().toUpperCase() === upperName,
    );

  useFrame(() => {
    if (!groupRef.current || !properties) return;

    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;

    const body = snapshot.find(
      (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
    );
    if (!body) return;

    let pos: Vector3Simple = body.position;
    if (
      properties.positionScale !== undefined &&
      properties.positionScale !== 1 &&
      properties.orbitingBody
    ) {
      const orbitingName = properties.orbitingBody;
      const orbiting = snapshot.find(
        (b: CelestialBody) =>
          b.name.trim().toUpperCase() === orbitingName.trim().toUpperCase(),
      );
      if (orbiting) {
        pos = scaleDistance(body.position, orbiting.position, properties.positionScale);
      }
    }

    groupRef.current.position.set(
      pos.x / simulationScale.positionScale,
      pos.y / simulationScale.positionScale,
      pos.z / simulationScale.positionScale,
    );
  });

  if (!properties) return null;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <Box
          style={{
            background: "transparent",
            padding: "4px 8px",
          }}
        >
          <Typography style={{ color: "#fff", margin: 0 }}>
            {bodyName}
          </Typography>
        </Box>
      </Html>
    </group>
  );
};

export default PlanetInfoOverlayAll;
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS. `Scene.tsx` and `PlanetInfoOverlayAll.tsx` are now consistent.

Run: `cd frontend && npm run build`
Expected: PASS.

---

## Task 6: Migrate BodySelector + InfoOverview off `currentSimulationSnapshot`

These are non-scene consumers of the soon-to-be-removed `currentSimulationSnapshot` field. Both need to migrate before we can drop the field cleanly.

**Files:**
- Modify: `frontend/src/app/components/interface/misc/BodySelector.tsx`
- Modify: `frontend/src/app/components/interface/drawer/components/InfoOverview.tsx`

- [ ] **Step 1: BodySelector — list bodies via `celestialBodyPropertiesList`, dispatch by name**

Replace the body of `BodySelector.tsx`:

```tsx
import React from "react";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  setActiveBody,
} from "@/app/store/slices/SimulationSlice";
import { RootState } from "@/app/store/Store";

import MercuryIcon from "@/assets/icons/mercury.png";
import VenusIcon from "@/assets/icons/venus.png";
import EarthIcon from "@/assets/icons/earth.png";
import MarsIcon from "@/assets/icons/mars.png";
import JupiterIcon from "@/assets/icons/jupiter.png";
import SaturnIcon from "@/assets/icons/saturn.png";
import UranusIcon from "@/assets/icons/uranus.png";
import NeptuneIcon from "@/assets/icons/neptune.png";
import MoonIcon from "@/assets/icons/moon.png";
import SunIcon from "@/assets/icons/sun.png";

import { StaticImageData } from "next/image";

const planetIcons: Record<string, StaticImageData> = {
  MERCURY: MercuryIcon as StaticImageData,
  VENUS: VenusIcon as StaticImageData,
  EARTH: EarthIcon as StaticImageData,
  MARS: MarsIcon as StaticImageData,
  JUPITER: JupiterIcon as StaticImageData,
  SATURN: SaturnIcon as StaticImageData,
  URANUS: UranusIcon as StaticImageData,
  NEPTUNE: NeptuneIcon as StaticImageData,
  MOON: MoonIcon as StaticImageData,
  SUN: SunIcon as StaticImageData,
};

const BodySelector: React.FC = () => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const propsList = useSelector(selectCelestialBodyPropertiesList) ?? [];

  const handleSelect = (name: string) => {
    // Resolve the live snapshot at click time so setActiveBody can keep
    // populating its CelestialBody payload (Task 9 narrows this to a name).
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = state.simulation.timeState.currentTimeStepKey;
    if (!simulationData || !currentTimeStepKey) return;
    const snapshot = simulationData[currentTimeStepKey];
    if (!snapshot) return;
    const body = snapshot.find((b: CelestialBody) => b.name === name);
    if (body) dispatch(setActiveBody(body));
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: "5%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        p: 1,
        borderRadius: 2,
        width: { xs: "90%", sm: "25%" },
      }}
    >
      {propsList.map((props: CelestialBodyProperties) => {
        if (!props.name) return null;
        const iconData = planetIcons[props.name.toUpperCase()];
        return (
          <IconButton
            key={props.name}
            onClick={() => handleSelect(props.name as string)}
            sx={{
              m: "0 10px",
              width: { xs: "90%", sm: "10%" },
              p: 0,
            }}
          >
            <Box
              component="img"
              src={iconData?.src ?? ""}
              alt={props.name}
              sx={{
                aspectRatio: "1/1",
                width: "100%",
                objectFit: "contain",
              }}
            />
          </IconButton>
        );
      })}
    </Box>
  );
};

export default BodySelector;
```

- [ ] **Step 2: InfoOverview — poll the live snapshot via `setInterval`**

This is a debug panel; per-frame React renders are wasteful. Replace `InfoOverview.tsx` content:

```tsx
import React, { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { RootState } from "@/app/store/Store";
import { CelestialBody } from "@/app/store/slices/SimulationSlice";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import theme from "@/muiTheme";

// Debug panel — refresh at 5 Hz, well below frame rate. Subscribing to Redux
// per frame would force a render of this whole MUI table on every animation
// tick, which is wasteful for a panel a human is reading.
const REFRESH_INTERVAL_MS = 200;

const InfoOverview: React.FC = () => {
  const store = useStore<RootState>();
  const [snapshot, setSnapshot] = useState<CelestialBody[]>([]);

  useEffect(() => {
    const tick = () => {
      const state = store.getState();
      const simulationData = state.simulation.simulationData;
      const key = state.simulation.timeState.currentTimeStepKey;
      if (simulationData && key && simulationData[key]) {
        setSnapshot(simulationData[key]);
      } else {
        setSnapshot([]);
      }
    };
    tick();
    const id = window.setInterval(tick, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [store]);

  return (
    <Paper
      sx={{
        width: "100%",
        height: "100%",
        padding: 2,
        backgroundColor: theme.palette.background.default,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: theme.palette.text.primary,
          marginBottom: 2,
        }}
      >
        Current Snapshot Information
      </Typography>
      {snapshot.length > 0 ? (
        <TableContainer
          component={Paper}
          sx={{ backgroundColor: theme.palette.background.default }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Planet Name</strong>
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Position</strong>
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.primary">
                    <strong>Velocity</strong>
                  </Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {snapshot.map((body: CelestialBody) => (
                <TableRow key={body.name}>
                  <TableCell>
                    <Typography variant="body2">{body.name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body3">
                      ({body.position.x.toExponential(2)},{" "}
                      {body.position.y.toExponential(2)},{" "}
                      {body.position.z.toExponential(2)})
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body3">
                      ({body.velocity.x.toFixed(2)},{" "}
                      {body.velocity.y.toFixed(2)},{" "}
                      {body.velocity.z.toFixed(2)})
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body1" color="text.secondary">
          No snapshot data available.
        </Typography>
      )}
    </Paper>
  );
};

export default InfoOverview;
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

---

## Task 7: AnimationController stops dispatching `updateActiveBody`

**Files:**
- Modify: `frontend/src/app/components/scene/AnimationController.tsx`

- [ ] **Step 1: Remove the per-frame `updateActiveBody` dispatch**

In `AnimationController.tsx`:

1. Remove the import of `updateActiveBody` from `SimulationSlice` (line 14).
2. Remove the `selectIsBodyActive` import (line 9).
3. Remove `const isBodyActive = useSelector(selectIsBodyActive);` (line 27).
4. Remove `const isBodyActiveRef = useRef(isBodyActive);` (line 33).
5. Remove the `useEffect` that syncs `isBodyActiveRef` (lines 49-51).
6. Remove the `if (isBodyActiveRef.current) { dispatch(updateActiveBody()); }` block (lines 68-70).

Final state of the imports + body should be:

```tsx
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  deleteExcessData,
  selectCurrentTimeStepIndex,
  selectIsPaused,
  selectSpeedMultiplier,
  selectTimeStepKeys,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch } from "@/app/store/Store";

const FRAME_INTERVAL = 1 / SimConstants.FPS;

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);
  const timeStepKeys = useSelector(selectTimeStepKeys);
  const currentTimeStepIndex = useSelector(selectCurrentTimeStepIndex);

  const currentIndexRef = useRef(currentTimeStepIndex);
  const timeStepKeysRef = useRef(timeStepKeys);
  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);
  const accRef = useRef(0);

  useEffect(() => {
    currentIndexRef.current = currentTimeStepIndex;
  }, [currentTimeStepIndex]);
  useEffect(() => {
    timeStepKeysRef.current = timeStepKeys;
  }, [timeStepKeys]);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    if (timeStepKeysRef.current.length > SimConstants.MAX_TIMESTEPS) {
      dispatch(
        deleteExcessData({
          excessCount: SimConstants.TIMESTEP_CHUNK_SIZE,
          timeStepKeys: timeStepKeysRef.current,
        }),
      );
      currentIndexRef.current = Math.max(
        0,
        currentIndexRef.current - SimConstants.TIMESTEP_CHUNK_SIZE,
      );
    }

    accRef.current += delta;
    if (accRef.current >= FRAME_INTERVAL) {
      accRef.current = 0;
      if (!isPausedRef.current && timeStepKeysRef.current.length > 0) {
        const stepsToMove = Math.abs(speedMultiplierRef.current);
        const direction = speedMultiplierRef.current > 0 ? 1 : -1;
        const nextIndex = Math.max(
          0,
          currentIndexRef.current + direction * stepsToMove,
        );
        currentIndexRef.current = nextIndex;
        dispatch(setCurrentTimeStepIndex(nextIndex));
      }
    }
  });

  return null;
};

export default AnimationController;
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

---

## Task 8: Drop dead state — `currentSimulationSnapshot`, `simulationSetSnapshotMiddleware`, `updateActiveBody` reducer, old `activeBody` field

Now nothing references the old surface area. Drop it.

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`
- Modify: `frontend/src/app/store/Store.ts`

- [ ] **Step 1: Remove `currentSimulationSnapshot` from state**

In `SimulationSlice.ts`:

1. Delete the `currentSimulationSnapshot: CelestialBody[];` field from `SimulationState` (line 83).
2. Delete `currentSimulationSnapshot: [],` from `initialState` (line 92).
3. Delete the `setCurrentSimulationSnapshot` reducer (lines 231-238).
4. Delete the `simulationSetSnapshotMiddleware` (lines 391-412).
5. Delete the `selectCurrentSimulationSnapshot` selector (lines 531-532).
6. Remove `setCurrentSimulationSnapshot` from the destructured `simulationSlice.actions` export at the bottom of the file.

- [ ] **Step 2: Remove the old `activeBody` field**

In `SimulationSlice.ts`:

1. Change `ActiveBodyState` to drop `activeBody: CelestialBody | null;`. Final form:

```ts
interface ActiveBodyState {
  isBodyActive: boolean;
  activeBodyName: string | null;
}
```

2. In `initialState.activeBodyState`, drop `activeBody: null,`.
3. Update the `setActiveBody` reducer to take a `string` (the body name) instead of a `CelestialBody`:

```ts
setActiveBody: (
  state: SimulationState,
  action: PayloadAction<string>,
) => {
  state.activeBodyState.activeBodyName = action.payload;
  state.activeBodyState.isBodyActive = true;
},
```

4. Delete the `updateActiveBody` reducer (lines 277-284).
5. Delete the `selectActiveBody` selector (lines 504-505).
6. Remove `updateActiveBody` from the destructured `simulationSlice.actions` export at the bottom.

- [ ] **Step 3: Update the two call sites of `setActiveBody`**

`setActiveBody` now takes a string (the body name). Update:

In `frontend/src/app/components/scene/Sphere.tsx`, change `handleClick`:

```ts
const handleClick = () => {
  dispatch(setActiveBody(name));
};
```

(Drop the snapshot-resolution logic — it was only there to populate the now-removed `activeBody.position` field.)

In `frontend/src/app/components/interface/misc/BodySelector.tsx`, change `handleSelect`:

```ts
const handleSelect = (name: string) => {
  dispatch(setActiveBody(name));
};
```

(Drop the snapshot-resolution logic and the unused `useStore<RootState>()`. Also drop the now-unused `CelestialBody` import.)

- [ ] **Step 4: Update `Store.ts` middleware list**

In `frontend/src/app/store/Store.ts`:

```ts
import { configureStore } from "@reduxjs/toolkit";
import simulationSliceReducer, {
  simulationUpdateDataMiddleware,
} from "./slices/SimulationSlice";
import requestReducer from "./slices/RequestSlice";

export const store = configureStore({
  reducer: {
    simulation: simulationSliceReducer,
    request: requestReducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).concat(simulationUpdateDataMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

- [ ] **Step 5: Verify nothing else references the removed names**

Run: `cd frontend && grep -rn "selectCurrentSimulationSnapshot\|currentSimulationSnapshot\|setCurrentSimulationSnapshot\|simulationSetSnapshotMiddleware\|updateActiveBody\|selectActiveBody\b" src/ --include="*.ts" --include="*.tsx"`

Expected: zero matches.

- [ ] **Step 6: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: PASS.

Run: `cd frontend && npm test`
Expected: PASS.

---

## Task 9: Verification — manual browser smoke test

Pure refactor, no behavior change. Manually exercise the affected flows and confirm parity with the pre-refactor experience.

**Files:** none (verification only).

- [ ] **Step 1: Start dev server**

Run: `cd frontend && npm run dev`

Run (in another terminal): `cd backend && ./mvnw spring-boot:run`

Wait for both to be ready (frontend on http://localhost:3000, backend on http://localhost:8080).

- [ ] **Step 2: Smoke test — golden path**

In a browser at `http://localhost:3000`:

- Load page → submit a sim with default parameters → wait for first chunk.
- **Verify:** all 9 bodies render at expected positions; orbits look correct over time.
- **Verify:** dev FPS counter (top-left) shows a stable rate. Numbers should not visibly degrade over a minute of playback.

- [ ] **Step 3: Smoke test — interactions**

- Click a body (e.g. Earth) → camera tracks. Body name appears in the active overlay.
- **Verify:** distance + velocity numbers in `PlanetInfoOverlayActive` update over time.
- **Verify:** clicking a different body re-targets the camera; overlay updates to the new body.
- Click empty space → overlay clears (`onPointerMissed` → `setIsBodyActive(false)`).

- [ ] **Step 4: Smoke test — controls**

- Toggle "Show Planet Info Overlay" → all body name labels appear; positions track with animation.
- Toggle "Show Trails" → trails appear and update.
- Cycle simulation scale (Realistic ↔ Semi-Realistic) → camera re-frames; bodies + trails redraw at new scale.
- Use BodySelector icons → click each → confirm camera tracks selected body.
- Scrub timeline → bodies jump to that time; trails update.
- Adjust speed multiplier → playback rate changes; reverse playback works.

- [ ] **Step 5: Smoke test — InfoOverview drawer**

- Open the drawer with InfoOverview → table populates with positions/velocities.
- Watch values for ~5 seconds → they should refresh ~5 times per second (set by REFRESH_INTERVAL_MS = 200).
- **Verify:** values are different across refreshes (proves the live read is wired up).

- [ ] **Step 6: Smoke test — performance regression check**

- Let the sim run for ~2 minutes at speed multiplier 4× or 8×.
- Watch FPS in dev counter.
- **Compare:** FPS should be at least as good as the pre-refactor baseline (and ideally better — the goal of the change). If FPS is *worse*, something is wrong; capture a profile and stop.

If anything in steps 2-6 fails or regresses, do not declare the work complete. Diagnose with the `superpowers:systematic-debugging` skill.

- [ ] **Step 7: Update todo.md**

Mark item #52 as complete in `/Users/byeonkho/code/spacesim/todo.md`. Add a one-line "DONE" note describing what landed (state shape change, imperative position pattern across Sphere/Camera/overlays, dropped middleware + slice field).

---

## Out of scope (intentionally not in this plan)

- **Camera per-frame allocations** (`offset.clone()`, etc. in `Camera.tsx`). Listed in `engineering_patterns_spacesim.md` as a known existing offender. Address in a follow-up if profiling shows it matters.
- **Backend integrator inner-loop audit** (todo #53). Independent piece of work.
- **Rename `webSocket*` artifacts** (todo #34). Independent.

## Risks / things to watch for

- **drei `<Html>` and the wrapper-group pattern (Tasks 4, 5).** drei reads its own internal `group.current.matrixWorld` to compute the HTML's screen position. Wrapping it in our own `<group ref>` and mutating that group's position propagates correctly via the parent → child world-matrix chain. Confirmed by inspection of `node_modules/@react-three/drei/web/Html.js` — it uses `updateWorldMatrix(true, false)` before reading position, so an ancestor group's transform is included.
- **First-frame race.** Sphere's `useFrame` won't run until the first frame. During the brief window between mount and first `useFrame` tick, `meshRef.current.position` is `(0, 0, 0)`. If the `<Canvas>` renders one frame before data arrives, all bodies briefly stack at origin. Acceptable: this is a sub-frame artifact, the data arrives within milliseconds, and the existing pre-refactor behavior had a similar empty-snapshot window. If it turns out to be visible, we can defer the mesh's visibility until first position write.
- **Click handler simplification (Task 8 Step 3).** When `setActiveBody` becomes name-only, Sphere's click handler no longer needs to look up the snapshot. Confirm before deleting that no consumer of `setActiveBody`'s payload was reading `body.position` or `body.velocity` at the moment of dispatch — they should all be doing imperative reads by that point.
