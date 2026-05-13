import { useFrame, useLoader } from "@react-three/fiber";
import React, { useMemo, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import {
  CelestialBody,
  CelestialBodyProperties,
  selectCelestialBodyPropertiesList,
  selectCurrentTimeStepKey,
  setActiveBody,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { setBodyWorldPosition } from "@/app/utils/coordinates";
import { findEarthIndex, writePivotInto } from "@/app/utils/framePivot";
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
// Softens the day/night terminator from a knife-edge into a gradient,
// faking the atmospheric-scattering look without an atmosphere shader.
// Patched via onBeforeCompile to keep meshStandardMaterial's full PBR
// pipeline (textures, normal maps) intact.
//
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
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  // Hoist body-property lookups to render scope so useFrame doesn't repeat
  // them per frame (closure + ~10 String.toUpperCase calls per body, every
  // frame, was the cost). useMemo recomputes only when propsList changes
  // (sim load / scale toggle) — effectively never per-frame.
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

  // useLoader's TextureLoader signature is awkward in current type stack;
  // cast is the conventional escape.
  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  // Reused across frames so moon-style scaled positions don't allocate a
  // Vector3Simple per frame.
  const posScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  // Frame-pivot scratch: holds the snapshot pivot point (Earth's position
  // in geo, zero in helio) so we can subtract it from `pos` without
  // allocating per frame.
  const pivotScratch = useRef<Vector3Simple>({ x: 0, y: 0, z: 0 });
  // Pivot body index, lazily resolved on the first valid snapshot. Same
  // caching pattern Trail.tsx uses for body/orbiting indices: backend
  // guarantees stable body order within a session.
  const earthIdxRef = useRef<number>(-1);

  useFrame((_, delta) => {
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = selectCurrentTimeStepKey(state);
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;
    const displayFrame = state.simulation.simulationParameters.displayFrame;

    if (simulationData && currentTimeStepKey) {
      const snapshot = simulationData[currentTimeStepKey];
      if (snapshot) {
        const body = snapshot.find((b: CelestialBody) => b.name === name);
        if (body) {
          let pos: Vector3Simple = body.position;
          if (positionScale !== 1 && orbitingBodyNameUpper) {
            const orbiting = snapshot.find(
              (b: CelestialBody) =>
                b.name.toUpperCase() === orbitingBodyNameUpper,
            );
            if (orbiting) {
              scaleDistanceInto(
                posScratch.current,
                body.position,
                orbiting.position,
                positionScale,
              );
              pos = posScratch.current;
            }
          }

          // Apply display-frame pivot subtraction. Helio writes a zero
          // pivot, so the math is free in that case but we keep one code
          // path to avoid branching the world-position write below.
          if (displayFrame !== "helio" && earthIdxRef.current === -1) {
            earthIdxRef.current = findEarthIndex(snapshot);
          }
          writePivotInto(
            pivotScratch.current,
            snapshot,
            displayFrame,
            earthIdxRef.current,
          );
          posScratch.current.x = pos.x - pivotScratch.current.x;
          posScratch.current.y = pos.y - pivotScratch.current.y;
          posScratch.current.z = pos.z - pivotScratch.current.z;
          pos = posScratch.current;

          setBodyWorldPosition(
            meshRef.current.position,
            pos,
            simulationScale.positionScale,
          );
          if (lightRef.current) {
            // Sun's light position tracks the Sun's mesh position so the
            // light direction is correct in geo (Sun moves) and helio
            // (Sun stays at origin). Intensity / decay set on the JSX
            // element below — fixed values, not scale-dependent.
            setBodyWorldPosition(
              lightRef.current.position,
              pos,
              simulationScale.positionScale,
            );
          }
        }
      }
    }

    // Spin (visual only — wall-clock based).
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
          solar-system viz. Intensity is unitless three.js (post-r155
          uses physically-based units when renderer.useLegacyLights=false,
          but we leave that default). */}
      {unlit && (
        <pointLight ref={lightRef} color={0xffffff} intensity={1.5} decay={0} />
      )}
    </>
  );
};

export default Sphere;
