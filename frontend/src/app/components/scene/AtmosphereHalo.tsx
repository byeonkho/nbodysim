import { useMemo } from "react";
import * as THREE from "three";
import type { HaloConfig } from "@/app/constants/BodyDecorations";

// Fresnel rim glow — a slightly larger transparent shell whose alpha rises at
// the limb (where the surface normal is perpendicular to the view direction).
// Additive blend + no depth write so it never z-fights the body surface.
const haloVertex = `
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const haloFragment = `
  uniform vec3 uTint;
  uniform float uPower;
  uniform float uIntensity;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float f = pow(1.0 - max(dot(normalize(vNormalW), normalize(vViewDir)), 0.0), uPower);
    gl_FragColor = vec4(uTint, f * uIntensity);
  }
`;

export function AtmosphereHalo({
  planetRadius,
  config,
}: {
  planetRadius: number;
  config: HaloConfig;
}) {
  const r = planetRadius * config.radiusScale;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTint: { value: new THREE.Color(config.tint) },
          uPower: { value: config.power },
          uIntensity: { value: config.intensity },
        },
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    [config.tint, config.power, config.intensity],
  );

  return (
    <mesh raycast={() => null} material={material}>
      <sphereGeometry args={[r, 32, 32]} />
    </mesh>
  );
}
