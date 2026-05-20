import { useFrame, useLoader } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import {
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  setActiveBody,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import { setBodyWorldPositionWithPreset } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { worldRadius, worldDistanceFromParent } from "@/app/utils/scalePipeline";
import * as THREE from "three";

interface SphereProps {
  name: string;
  radius: number;
  textureUrl?: string;
  rotationSpeed?: number;
  unlit?: boolean;
}

// Half-Lambert wrap shading: replaces `saturate(dot(N, L))` with
// `dot(N, L) * 0.5 + 0.5` in the standard physical fragment shader, so
// even surfaces facing away from the Sun get a fraction of irradiance.
// Defined at module scope so the function identity is stable across
// renders — otherwise R3F treats every render's new closure as a
// different material, forcing a recompile per frame.
const halfLambertOverride = (shader: { fragmentShader: string }) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );",
    "float dotNL = dot( geometryNormal, directLight.direction ) * 0.5 + 0.5;",
  );
};

/**
 * Renders one celestial body. Position updates imperatively inside useFrame
 * by reading the live chunk buffer via store.getState() — never subscribes
 * per frame, so React reconciliation only fires on identity / scale changes
 * (texture, radius), not on every animation tick.
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
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  const { orbitingBodyNameUpper, ownRadiusM } = useMemo(() => {
    const nameUpper = name.toUpperCase();
    const bodyProps: CelestialBodyProperties | undefined = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === nameUpper,
    );
    return {
      orbitingBodyNameUpper: bodyProps?.orbitingBody?.toUpperCase(),
      ownRadiusM: bodyProps?.radius ?? 0,
    };
  }, [name, propsList]);

  const parentRadiusM = useMemo(() => {
    if (!orbitingBodyNameUpper) return 0;
    const parent = propsList?.find(
      (bp: CelestialBodyProperties) =>
        bp.name?.toUpperCase() === orbitingBodyNameUpper,
    );
    return parent?.radius ?? 0;
  }, [orbitingBodyNameUpper, propsList]);

  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  // Scratch Vector3s for per-frame reads — never reallocated. Body-index
  // refs are lazily resolved on the first valid buffer (backend guarantees
  // stable body order within a session).
  const posScratchVec = useRef(new THREE.Vector3());
  const orbitingScratchVec = useRef(new THREE.Vector3());
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const posSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const orbitingSimple = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const parentWorldScratch = useRef(new THREE.Vector3());
  const childDeltaScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  const bodyIdxRef = useRef<number>(-1);
  const orbitingIdxRef = useRef<number>(-1);

  useFrame((_, delta) => {
    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;
    const simulationScale = state.simulation.simulationParameters.simulationScale;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    if (buffer && idx < buffer.totalTimesteps) {
      // Lazy-resolve cached body indices. Match case-insensitively because
      // bodyProps name casing can differ from what the backend ships in the
      // chunk header (which feeds bodyNameToIndex).
      if (bodyIdxRef.current === -1) {
        const targetUpper = name.toUpperCase();
        for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
          if (bn.toUpperCase() === targetUpper) {
            bodyIdxRef.current = i;
            break;
          }
        }
        if (orbitingBodyNameUpper && orbitingIdxRef.current === -1) {
          for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
            if (bn.toUpperCase() === orbitingBodyNameUpper) {
              orbitingIdxRef.current = i;
              break;
            }
          }
        }
      }

      const bodyIdx = bodyIdxRef.current;
      if (bodyIdx >= 0) {
        readBodyPositionInto(posScratchVec.current, buffer, idx, bodyIdx);
        posSimple.current.x = posScratchVec.current.x;
        posSimple.current.y = posScratchVec.current.y;
        posSimple.current.z = posScratchVec.current.z;

        // Display-frame pivot. Helio writes zero, so no branch needed.
        writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
        posSimple.current.x -= pivotScratch.current.x;
        posSimple.current.y -= pivotScratch.current.y;
        posSimple.current.z -= pivotScratch.current.z;

        if (orbitingBodyNameUpper && orbitingIdxRef.current >= 0) {
          // Body has a parent — apply the body-agnostic minimum-separation
          // rule. Generalizes the Moon ×15 hack to work for any future
          // small satellite (Phobos/Deimos, Europa, Titan, etc.) without
          // per-body hardcoding.
          readBodyPositionInto(
            orbitingScratchVec.current,
            buffer,
            idx,
            orbitingIdxRef.current,
          );
          orbitingSimple.current.x =
            orbitingScratchVec.current.x - pivotScratch.current.x;
          orbitingSimple.current.y =
            orbitingScratchVec.current.y - pivotScratch.current.y;
          orbitingSimple.current.z =
            orbitingScratchVec.current.z - pivotScratch.current.z;

          // Parent's world-unit position via the pipeline.
          setBodyWorldPositionWithPreset(
            parentWorldScratch.current,
            orbitingSimple.current,
            simulationScale.preset,
          );

          // Child world-relative-to-parent delta with min-separation rule.
          // Child + parent world radii derived from real metres via worldRadius.
          worldDistanceFromParent(
            posSimple.current,
            orbitingSimple.current,
            worldRadius(parentRadiusM, simulationScale.preset),
            worldRadius(ownRadiusM, simulationScale.preset),
            simulationScale.preset,
            childDeltaScratch.current,
          );

          // worldDistanceFromParent returns the delta in input ICRF axes —
          // Y/Z swap NOT applied. The parent world position above came through
          // setBodyWorldPositionWithPreset which DID apply the swap. Apply the
          // swap to the delta (delta.y → world Z, delta.z → world Y) before
          // summing so both terms are in three.js world space.
          meshRef.current.position.set(
            parentWorldScratch.current.x + childDeltaScratch.current.x,
            parentWorldScratch.current.y + childDeltaScratch.current.z,
            parentWorldScratch.current.z + childDeltaScratch.current.y,
          );
        } else {
          // No parent — straight pipeline transform. setBodyWorldPositionWithPreset
          // applies the Y/Z swap internally.
          setBodyWorldPositionWithPreset(
            meshRef.current.position,
            posSimple.current,
            simulationScale.preset,
          );
        }

        if (lightRef.current) {
          setBodyWorldPositionWithPreset(
            lightRef.current.position,
            posSimple.current,
            simulationScale.preset,
          );
        }
      }
    }

    meshRef.current.rotation.y += rotationSpeed * delta;
  });

  const handleClick = () => {
    dispatch(setActiveBody(name));
  };

  return (
    <>
      <mesh ref={meshRef} onClick={handleClick}>
        <sphereGeometry args={[radius, 32, 32]} />
        {unlit ? (
          <meshBasicMaterial map={textureUrl ? texture : undefined} />
        ) : (
          <meshStandardMaterial
            map={textureUrl ? texture : undefined}
            onBeforeCompile={halfLambertOverride}
          />
        )}
      </mesh>
      {/* decay=0 → no distance falloff, so every body gets equal direct
          light from the Sun regardless of scene-space distance. Real
          inverse-square would make outer planets pitch black or inner
          ones blown out at our scales; standard artistic license for
          solar-system viz. */}
      {unlit && (
        <pointLight ref={lightRef} color={0xffffff} intensity={1.5} decay={0} />
      )}
    </>
  );
};

export default Sphere;
