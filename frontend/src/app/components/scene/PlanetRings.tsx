import { useMemo } from "react";
import * as THREE from "three";
import type { RingConfig } from "@/app/constants/BodyDecorations";

// Procedural Saturn rings: concentric bands in a pale gold->tan gradient, with
// an alpha gap at the Cassini division and fades at the inner/outer edges.
// Radially symmetric, so the planet spinning underneath is invisible.
const ringVertex = `
  uniform float uInner;
  uniform float uOuter;
  varying float vT;
  void main() {
    float r = length(position.xy);
    vT = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = `
  uniform float uCassiniT;
  varying float vT;
  void main() {
    vec3 colA = vec3(0.86, 0.78, 0.60);
    vec3 colB = vec3(0.60, 0.53, 0.40);
    vec3 col = mix(colA, colB, vT);
    // fine concentric banding (scale-invariant: keyed on normalized radius)
    float bands = 0.5 + 0.5 * sin(vT * 90.0);
    col *= mix(0.82, 1.0, bands);
    float alpha = 0.85;
    // inner C-ring fade-in + outer edge fade-out
    alpha *= smoothstep(0.0, 0.06, vT);
    alpha *= 1.0 - smoothstep(0.94, 1.0, vT);
    // Cassini division: alpha dip around the normalized cassini radius
    float d = abs(vT - uCassiniT);
    alpha *= mix(0.04, 1.0, smoothstep(0.0, 0.04, d));
    gl_FragColor = vec4(col, alpha);
  }
`;

export function PlanetRings({
  planetRadius,
  config,
}: {
  planetRadius: number;
  config: RingConfig;
}) {
  const inner = planetRadius * config.innerScale;
  const outer = planetRadius * config.outerScale;
  const cassiniT =
    (config.cassiniScale - config.innerScale) /
    (config.outerScale - config.innerScale);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInner: { value: inner },
          uOuter: { value: outer },
          uCassiniT: { value: cassiniT },
        },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [inner, outer, cassiniT],
  );

  // RingGeometry lies in the XY plane; rotate -90deg about X to lay it flat
  // (equatorial). The body group's tilt then presents it obliquely.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} material={material}>
      <ringGeometry args={[inner, outer, 128]} />
    </mesh>
  );
}
