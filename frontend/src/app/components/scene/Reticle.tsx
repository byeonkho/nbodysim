"use client";

import { useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useSelector, useStore } from "react-redux";
import * as THREE from "three";
import {
  type CelestialBody,
  type CelestialBodyProperties,
  selectActiveBodyName,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  selectIsBodyActive,
  selectSimulationScale,
  type Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import type { RootState } from "@/app/store/Store";
import {
  calculateDistance,
  calculateMagnitude,
  formatToKM,
  scaleDistanceInto,
  subtractInto,
} from "@/app/utils/helpers";
import { BODY_DISPLAY, BODY_NAIF, toBodyKey } from "@/app/constants/BodyVisuals";

// In-scene reticle on the active body — three concentric accent rings,
// N/E/S/W tick marks, leader line, and a label cluster offset to the
// upper-left. Position updates via group ref per frame; numerics update
// via DOM refs (gated by lastValue refs to skip identical writes).
//
// Replaces PlanetInfoOverlayActive. Same projection / positioning logic;
// the visual tree is what changed.

export function Reticle() {
  const activeBodyName = useSelector(selectActiveBodyName);
  const isBodyActive = useSelector(selectIsBodyActive);
  const propsList = useSelector(selectCelestialBodyPropertiesList);
  const simulationScale = useSelector(selectSimulationScale);
  const store = useStore<RootState>();

  const groupRef = useRef<THREE.Group>(null!);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const velRef = useRef<HTMLSpanElement>(null);
  const posScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const velScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const lastRange = useRef<string>("");
  const lastVel = useRef<string>("");

  const upperName = activeBodyName?.trim().toUpperCase() ?? "";
  const activeProps: CelestialBodyProperties | undefined = upperName
    ? propsList?.find(
        (p: CelestialBodyProperties) =>
          p.name?.trim().toUpperCase() === upperName,
      )
    : undefined;
  const orbitingNameUpper =
    activeProps?.orbitingBody?.trim().toUpperCase() ?? "";

  useFrame(() => {
    if (!isBodyActive || !upperName || !activeProps || !groupRef.current)
      return;

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

    const orbiting = orbitingNameUpper
      ? snapshot.find(
          (b: CelestialBody) =>
            b.name.trim().toUpperCase() === orbitingNameUpper,
        )
      : undefined;
    if (!orbiting) return;

    const positionScale = activeProps.positionScale ?? 1;
    let pos: Vector3Simple = body.position;
    if (positionScale !== 1) {
      scaleDistanceInto(
        posScratch.current,
        body.position,
        orbiting.position,
        positionScale,
      );
      pos = posScratch.current;
    }
    groupRef.current.position.set(
      pos.x / simulationScale.positionScale,
      pos.y / simulationScale.positionScale,
      pos.z / simulationScale.positionScale,
    );

    const range = calculateDistance(body.position, orbiting.position, "AU");
    if (range !== lastRange.current && rangeRef.current) {
      rangeRef.current.textContent = range;
      lastRange.current = range;
    }
    subtractInto(velScratch.current, body.velocity, orbiting.velocity);
    const vel = formatToKM(calculateMagnitude(velScratch.current));
    if (vel !== lastVel.current && velRef.current) {
      velRef.current.textContent = vel;
      lastVel.current = vel;
    }
  });

  // Reset cached values on body switch so first frame after switch writes
  // through unconditionally.
  useEffect(() => {
    lastRange.current = "";
    lastVel.current = "";
  }, [activeBodyName]);

  if (!upperName || !isBodyActive || !activeProps) return null;

  const bodyKey = toBodyKey(upperName);
  const display = bodyKey ? BODY_DISPLAY[bodyKey].toUpperCase() : upperName;
  const naif = bodyKey ? BODY_NAIF[bodyKey] : "—";

  return (
    <group ref={groupRef}>
      <Html style={{ pointerEvents: "none" }}>
        <div className="relative">
          <svg
            width="160"
            height="160"
            style={{ position: "absolute", left: -80, top: -80 }}
          >
            <circle
              cx="80"
              cy="80"
              r="44"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.15"
            />
            <circle
              cx="80"
              cy="80"
              r="30"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.55"
            />
            {[0, 90, 180, 270].map((a) => (
              <g key={a} transform={`rotate(${a} 80 80)`}>
                <line
                  x1="80"
                  y1="32"
                  x2="80"
                  y2="40"
                  stroke="var(--color-accent)"
                  strokeWidth="1"
                  opacity="0.7"
                />
              </g>
            ))}
          </svg>

          {/* Leader line drawn in its own SVG so it can extend beyond the
              160x160 reticle box without clipping. */}
          <svg
            width="320"
            height="120"
            style={{ position: "absolute", left: -290, top: -90, overflow: "visible" }}
          >
            <path
              d="M 268 88 L 200 50 L 30 50"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1"
              opacity="0.55"
            />
            <circle cx="268" cy="88" r="2.5" fill="var(--color-accent)" />
          </svg>

          <div
            className="absolute font-mono"
            style={{
              left: -260,
              top: -52,
              whiteSpace: "nowrap",
              letterSpacing: "0.10em",
            }}
          >
            <div className="text-accent text-[10px] font-semibold">
              ● TGT · {display} ({naif})
            </div>
            <div className="text-dim mt-0.5 text-[9.5px]">
              Range <span ref={rangeRef}>—</span> · v{" "}
              <span ref={velRef}>—</span>
            </div>
          </div>
        </div>
      </Html>
    </group>
  );
}
