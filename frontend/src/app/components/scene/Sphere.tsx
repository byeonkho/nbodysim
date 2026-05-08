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
import { scaleDistanceInto } from "@/app/utils/helpers";
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
  const propsList = useSelector(selectCelestialBodyPropertiesList);

  // Hoist body-property lookups to render scope so useFrame doesn't repeat
  // them per frame (closure + ~10 String.toUpperCase calls per body, every
  // frame, was the cost). useMemo recomputes only when propsList changes
  // (sim load / scale toggle) — effectively never per-frame.
  const { positionScale, orbitingBodyNameUpper } = useMemo(() => {
    const nameUpper = name.toUpperCase();
    const bodyProps: CelestialBodyProperties | undefined = propsList?.find(
      (bp) => bp.name?.toUpperCase() === nameUpper,
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

  useFrame((_, delta) => {
    const state = store.getState();
    const simulationData = state.simulation.simulationData;
    const currentTimeStepKey = selectCurrentTimeStepKey(state);
    const simulationScale =
      state.simulation.simulationParameters.simulationScale;

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
          <meshStandardMaterial map={textureUrl ? texture : undefined} />
        )}
      </mesh>
      {unlit && <pointLight ref={lightRef} color={0xffffff} />}
    </>
  );
};

export default Sphere;
