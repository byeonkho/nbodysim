import { ThreeElements, useFrame, useLoader } from "@react-three/fiber";
import React, { useRef } from "react";
import { useDispatch } from "react-redux";
import { AppDispatch } from "@/app/store/Store";
import {
  CelestialBody,
  setActiveBody,
} from "@/app/store/slices/SimulationSlice";
import * as THREE from "three";

type CelestialBodyProps = ThreeElements["mesh"] & {
  name: string;
  radius: number;
  body: CelestialBody;
  textureUrl?: string;
  rotationSpeed?: number;
  unlit?: boolean;
};

const Sphere: React.FC<CelestialBodyProps> = ({
  radius,
  position,
  body,
  textureUrl,
  rotationSpeed = 0.1,
  unlit = false,
  ...props
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const dispatch = useDispatch<AppDispatch>();

  // useLoader's type signature with TextureLoader is awkward in current
  // R3F + drei + three-stdlib type stack; cast is the conventional escape.
  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  useFrame((_, delta) => {
    meshRef.current.rotation.y += rotationSpeed * delta;
  });

  return (
    <mesh
      {...props}
      position={position}
      ref={meshRef}
      onClick={() => dispatch(setActiveBody(body))}
    >
      <sphereGeometry args={[radius, 32, 32]} />
      {unlit ? (
        <meshBasicMaterial map={textureUrl ? texture : undefined} />
      ) : (
        <meshStandardMaterial map={textureUrl ? texture : undefined} />
      )}
    </mesh>
  );
};

export default Sphere;
