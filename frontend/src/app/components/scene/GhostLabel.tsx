"use client";

import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBody,
  type CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  selectSimulationScale,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import type { RootState } from "@/app/store/Store";
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { calculateDistance, scaleDistanceInto } from "@/app/utils/helpers";
import { BODY_DISPLAY, toBodyKey } from "@/app/constants/BodyVisuals";

// Two-line ghost label above each non-active body: NAME (uppercase, wide
// tracking) + AU sub. Position updates per frame; AU text updates every
// ~0.5s at 60fps to avoid pointless DOM thrashing on slow-moving outer
// planets. Replaces PlanetInfoOverlayAll.

const TEXT_THROTTLE_FRAMES = 30;

export function GhostLabel({ bodyName }: { bodyName: string }) {
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const simulationScale = useSelector(selectSimulationScale);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const auRef = useRef<HTMLDivElement>(null);
  const posScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const frameCounter = useRef(0);
  const lastAu = useRef<string>("");

  const upperName = bodyName.trim().toUpperCase();
  const properties: CelestialBodyProperties | undefined = propsList?.find(
    (p: CelestialBodyProperties) => p.name?.trim().toUpperCase() === upperName,
  );
  const orbitingNameUpper =
    properties?.orbitingBody?.trim().toUpperCase() ?? "";

  useFrame(() => {
    if (!groupRef.current || !properties) return;

    const state = store.getState();
    const data = state.simulation.simulationData;
    const key = selectCurrentTimeStepKey(state);
    if (!data || !key) return;
    const snapshot = data[key];
    if (!snapshot) return;

    const body = snapshot.find(
      (b: CelestialBody) => b.name.trim().toUpperCase() === upperName,
    );
    if (!body) return;

    let pos: Vector3Simple = body.position;
    if (
      properties.positionScale !== undefined &&
      properties.positionScale !== 1 &&
      orbitingNameUpper
    ) {
      const orbiting = snapshot.find(
        (b: CelestialBody) =>
          b.name.trim().toUpperCase() === orbitingNameUpper,
      );
      if (orbiting) {
        scaleDistanceInto(
          posScratch.current,
          body.position,
          orbiting.position,
          properties.positionScale,
        );
        pos = posScratch.current;
      }
    }
    setBodyWorldPosition(
      groupRef.current.position,
      pos,
      simulationScale.positionScale,
    );

    frameCounter.current++;
    if (frameCounter.current >= TEXT_THROTTLE_FRAMES) {
      frameCounter.current = 0;
      const orbiting = orbitingNameUpper
        ? snapshot.find(
            (b: CelestialBody) =>
              b.name.trim().toUpperCase() === orbitingNameUpper,
          )
        : undefined;
      if (orbiting) {
        const au = calculateDistance(body.position, orbiting.position, "AU");
        if (au !== lastAu.current && auRef.current) {
          auRef.current.textContent = au;
          lastAu.current = au;
        }
      }
    }
  });

  if (!properties) return null;

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey ? BODY_DISPLAY[bodyKey] : bodyName;

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }} center>
        <div
          className="text-center font-medium uppercase"
          style={{ transform: "translateY(-180%)", whiteSpace: "nowrap" }}
        >
          <div
            className="text-[9.5px]"
            style={{
              color: "rgba(220,221,227,0.50)",
              letterSpacing: "0.20em",
            }}
          >
            {display}
          </div>
          <div
            ref={auRef}
            className="tabular mt-0.5 font-mono text-[8.5px]"
            style={{ color: "rgba(220,221,227,0.32)" }}
          />
        </div>
      </Html>
    </group>
  );
}
