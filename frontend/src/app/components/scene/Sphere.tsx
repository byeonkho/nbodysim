import { ThreeElements, useLoader } from "@react-three/fiber";
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
  color?: THREE.ColorRepresentation;
  radius: number;
  body: CelestialBody;
  textureUrl?: string;
};

const Sphere: React.FC<CelestialBodyProps> = ({
  radius,
  position,
  name,
  color = "orange",
  body,
  textureUrl,
  ...props
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const dispatch = useDispatch<AppDispatch>();

  const texture = useLoader(
    THREE.TextureLoader as any,
    textureUrl || "/path/to/placeholder.png",
  );

  return (
    <mesh
      {...props}
      position={position}
      ref={meshRef}
      onClick={() => dispatch(setActiveBody(body))}
    >
      <sphereGeometry args={[radius, 32, 32]} />
      <meshStandardMaterial map={textureUrl ? texture : undefined} />
    </mesh>
  );
};

export default Sphere;
