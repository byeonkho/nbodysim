import * as THREE from "three";
import type { ShapeConfig } from "@/app/constants/BodyShapes";
import { mulberry32, makeSimplex3D, fbm } from "@/app/utils/noise";

/**
 * Builds a deformed UV-sphere for a small rocky body. The sphere's vertices are
 * displaced along their radial direction by seeded fractal noise (clamped to
 * [-1,1] so the envelope is a hard guarantee), then stretched per-axis by
 * config.scale. UVs are untouched, so the body's equirectangular texture still
 * maps. Normals are recomputed so lighting shades the bumps.
 *
 * One-time build per body (called inside a useMemo) — not hot-path code.
 */
export function makeIrregularGeometry(
  radius: number,
  segments: [number, number],
  config: ShapeConfig,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, segments[0], segments[1]);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const noise = makeSimplex3D(mulberry32(config.seed));
  const [sx, sy, sz] = config.scale;

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Unit direction of this vertex.
    const dx = v.x / radius;
    const dy = v.y / radius;
    const dz = v.z / radius;
    let n = fbm(
      noise,
      dx * config.frequency,
      dy * config.frequency,
      dz * config.frequency,
      config.octaves,
    );
    // Clamp so the displaced radius never exceeds radius*(1+amplitude): makes the
    // envelope (and the camera-clearance reasoning) a hard guarantee.
    if (n > 1) n = 1;
    else if (n < -1) n = -1;
    const r = radius * (1 + config.amplitude * n);
    pos.setXYZ(i, dx * r * sx, dy * r * sy, dz * r * sz);
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals();

  // Guard against zero-length normals: degenerate triangles at the UV-sphere
  // poles can make computeVertexNormals emit (0,0,0), which renders as an unlit
  // speck. Fall back to the radial direction (a good approximation for a
  // displaced sphere) at those vertices.
  const nrm = geometry.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) {
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    if (nx * nx + ny * ny + nz * nz < 1e-12) {
      v.fromBufferAttribute(pos, i).normalize();
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
  }
  nrm.needsUpdate = true;

  return geometry;
}
