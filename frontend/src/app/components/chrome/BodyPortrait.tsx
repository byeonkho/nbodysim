"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import * as THREE from "three";
import { type BodyKey, BODY_COLOR, BODY_TEXTURE } from "@/app/constants/BodyVisuals";

// Small live render of the selected body for the info-panel header. A textured
// sphere lit from the Sun's real direction (so its real day/night phase reads),
// gently spinning, fixed camera. Self-contained: its own tiny WebGL canvas,
// decoupled from the main scene. Design decisions: see the live-body-render spec.

const CAM_DIST = 4.2;
const SPHERE_RADIUS = 1;
const LIGHT_DIST = 6;
const DIR_LIGHT_INTENSITY = 3;
const AMBIENT_INTENSITY = 0.12;
const SPIN_RATE = 0.35; // rad/s, gentle decorative spin (tunable)

// Light direction used before the first buffer read resolves, and as the
// fallback when the Sun isn't in the selected set: up-and-to-the-left, so the
// body is never born fully dark. Module scope so the Vector3 is allocated once.
const DEFAULT_LIGHT_DIR = new THREE.Vector3(-0.6, 0.4, 0.7).normalize();

interface BodyPortraitProps {
  body: BodyKey;
  size?: number;
}

export function BodyPortrait({ body, size = 44 }: BodyPortraitProps) {
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {/* Subtle body-tinted glow ring, preserving the header's prior look. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          boxShadow: `0 0 ${Math.round(size * 0.4)}px ${BODY_COLOR[body]}55`,
        }}
      />
      <Canvas
        flat
        gl={{ alpha: true }}
        dpr={[1, 2]}
        camera={{ position: [0, 0, CAM_DIST], fov: 30, near: 0.1, far: 100 }}
        style={{ width: size, height: size, position: "relative", pointerEvents: "none" }}
      >
        <Suspense fallback={null}>
          <PortraitSphere body={body} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function PortraitSphere({ body }: { body: BodyKey }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const lightRef = useRef<THREE.DirectionalLight>(null!);

  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    BODY_TEXTURE[body].src,
  );

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += SPIN_RATE * delta;
    if (lightRef.current) {
      lightRef.current.position.copy(DEFAULT_LIGHT_DIR).multiplyScalar(LIGHT_DIST);
    }
  });

  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight ref={lightRef} intensity={DIR_LIGHT_INTENSITY} />
      <mesh ref={meshRef}>
        <sphereGeometry args={[SPHERE_RADIUS, 48, 48]} />
        <meshStandardMaterial map={texture} />
      </mesh>
    </>
  );
}
