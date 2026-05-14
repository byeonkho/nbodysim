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
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { writePivotInto } from "@/app/utils/framePivot";
import { scaleDistanceInto } from "@/app/utils/helpers";
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

  const { positionScale, orbitingBodyNameUpper } = useMemo(() => {
    const nameUpper = name.toUpperCase();
    const bodyProps: CelestialBodyProperties | undefined = propsList?.find(
      (bp: CelestialBodyProperties) => bp.name?.toUpperCase() === nameUpper,
    );
    return {
      positionScale: bodyProps?.positionScale ?? 1,
      orbitingBodyNameUpper: bodyProps?.orbitingBody?.toUpperCase(),
    };
  }, [name, propsList]);

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

        if (positionScale !== 1 && orbitingIdxRef.current >= 0) {
          readBodyPositionInto(
            orbitingScratchVec.current,
            buffer,
            idx,
            orbitingIdxRef.current,
          );
          orbitingSimple.current.x = orbitingScratchVec.current.x;
          orbitingSimple.current.y = orbitingScratchVec.current.y;
          orbitingSimple.current.z = orbitingScratchVec.current.z;
          scaleDistanceInto(
            posSimple.current,
            posSimple.current,
            orbitingSimple.current,
            positionScale,
          );
        }

        // Display-frame pivot. Helio writes zero, so no branch needed below.
        writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
        posSimple.current.x -= pivotScratch.current.x;
        posSimple.current.y -= pivotScratch.current.y;
        posSimple.current.z -= pivotScratch.current.z;

        setBodyWorldPosition(
          meshRef.current.position,
          posSimple.current,
          simulationScale.positionScale,
        );
        if (lightRef.current) {
          setBodyWorldPosition(
            lightRef.current.position,
            posSimple.current,
            simulationScale.positionScale,
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
