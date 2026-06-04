"use client";

import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import { useStore } from "react-redux";
import * as THREE from "three";
import { type BodyKey, BODY_COLOR, BODY_TEXTURE } from "@/app/constants/BodyVisuals";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import type { RootState } from "@/app/store/Store";

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
  const store = useStore<RootState>();
  const isSun = body === "SUN";

  const texture = useLoader(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    THREE.TextureLoader as any,
    BODY_TEXTURE[body].src,
  );

  // Scratch vectors — never reallocated (hot path).
  const bodyScratch = useRef(new THREE.Vector3());
  const sunScratch = useRef(new THREE.Vector3());

  // Cached buffer slots. Active-body component: the rendered body is dynamic, so
  // invalidate on BOTH buffer identity AND body change (the DriftOverlay
  // precedent, not the fixed-body Sphere/Trail one).
  const bodyIdxRef = useRef(-1);
  const sunIdxRef = useRef(-1);
  const resolvedBufferRef = useRef<object | null>(null);
  const resolvedBodyRef = useRef<BodyKey | null>(null);

  useFrame((_, delta) => {
    if (meshRef.current) meshRef.current.rotation.y += SPIN_RATE * delta;
    if (isSun) return; // emissive — no phase, and self-difference is a zero vector
    const light = lightRef.current;
    if (!light) return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    const idx = state.simulation.timeState.currentTimeStepIndex;

    // No positions yet — keep a sensible default so the body isn't born dark.
    if (!buffer || idx >= buffer.totalTimesteps) {
      light.position.copy(DEFAULT_LIGHT_DIR).multiplyScalar(LIGHT_DIST);
      return;
    }

    if (resolvedBufferRef.current !== buffer || resolvedBodyRef.current !== body) {
      bodyIdxRef.current = -1;
      sunIdxRef.current = -1;
      resolvedBufferRef.current = buffer;
      resolvedBodyRef.current = body;
    }
    if (bodyIdxRef.current === -1) {
      for (const [bn, i] of buffer.bodyNameToIndex.entries()) {
        const up = bn.toUpperCase();
        if (up === body) bodyIdxRef.current = i;
        if (up === "SUN") sunIdxRef.current = i;
      }
    }

    const bodyIdx = bodyIdxRef.current;
    const sunIdx = sunIdxRef.current;
    // Body or Sun not in this sim — fall back to the default direction.
    if (bodyIdx < 0 || sunIdx < 0) {
      light.position.copy(DEFAULT_LIGHT_DIR).multiplyScalar(LIGHT_DIST);
      return;
    }

    readBodyPositionInto(bodyScratch.current, buffer, idx, bodyIdx);
    readBodyPositionInto(sunScratch.current, buffer, idx, sunIdx);

    // Raw ICRF direction body -> Sun. Translation-invariant, so no frame pivot
    // or scale pipeline needed (the geo/helio pivot is a common translation that
    // cancels in the difference). Map ICRF -> portrait space with the scene's
    // Y/Z swap (ICRF z -> portrait up) so the orbit's sun direction sweeps the
    // portrait's horizontal plane and the phase varies fully over the orbit.
    const dx = sunScratch.current.x - bodyScratch.current.x;
    const dy = sunScratch.current.y - bodyScratch.current.y;
    const dz = sunScratch.current.z - bodyScratch.current.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    light.position.set(
      (dx / len) * LIGHT_DIST,
      (dz / len) * LIGHT_DIST,
      (dy / len) * LIGHT_DIST,
    );
  });

  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} />
      <directionalLight ref={lightRef} intensity={DIR_LIGHT_INTENSITY} />
      <mesh ref={meshRef}>
        <sphereGeometry args={[SPHERE_RADIUS, 48, 48]} />
        {isSun ? (
          <meshBasicMaterial map={texture} />
        ) : (
          <meshStandardMaterial map={texture} />
        )}
      </mesh>
    </>
  );
}
