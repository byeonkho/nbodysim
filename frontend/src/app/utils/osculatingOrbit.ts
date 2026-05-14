import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

// Hot-path Keplerian-ellipse generator. Given a body's instantaneous state
// vector (r, v) relative to its central body and the central body's µ,
// writes `segments` 3D points around the closed osculating ellipse into
// a pre-allocated Float32Array (3 floats per point, parent-relative
// metres in ICRF axes).
//
// Distinct from orbitalElements.ts: that module returns scalar elements
// (a, e, i, ν, T) for the body card at ~5 Hz with allocations; this one
// returns geometry for OrbitPath rendering at ≥60 Hz with zero allocations.
// We skip the inclination / RAAN / argument-of-periapsis extraction
// because building the orbital basis directly from h⃗ and e⃗ avoids both
// the trig and the i≈0 / e≈0 singularities those angles have.
//
// Output is in raw ICRF metres — the rendering Y/Z swap and positionScale
// division belong to the caller (mirrors coordinates.ts contract).

export interface OrbitScratch {
  exHat: Vector3Simple;
  eyHat: Vector3Simple;
}

export function makeOrbitScratch(): OrbitScratch {
  return {
    exHat: { x: 0, y: 0, z: 0 },
    eyHat: { x: 0, y: 0, z: 0 },
  };
}

const TWO_PI = Math.PI * 2;

/**
 * Compute the osculating Keplerian ellipse and write its sampled points
 * into `out`. Returns true if bound (computed); false if µ ≤ 0, the
 * trajectory is unbound (parabolic / hyperbolic), or the inputs are
 * degenerate (zero radius / velocity, radial trajectory). On false, `out`
 * is left untouched so the caller should hide its geometry.
 *
 * Uses eccentric anomaly E ∈ [0, 2π) as the sampling parameter — this
 * gives uniform vertex spacing in the parametric sense, which is visually
 * adequate for orbit-path rendering. (Sampling by true anomaly would
 * concentrate vertices near periapsis where the body moves fastest;
 * sampling by E gives a slight density toward apoapsis at high e, but
 * for solar-system eccentricities (<0.25) the difference is invisible.)
 *
 * Hot-path callable: no allocations, all intermediates live in `scratch`
 * or local primitives. Total cost per call ≈ segments × (sin + cos + ~12
 * muls/adds) plus a small constant setup — at segments=96 × 9 bodies ×
 * 60 Hz, ≈ 100k trig ops/sec, negligible.
 */
export function writeOsculatingEllipsePoints(
  out: Float32Array,
  segments: number,
  r: Vector3Simple,
  v: Vector3Simple,
  mu: number,
  scratch: OrbitScratch,
): boolean {
  if (!Number.isFinite(mu) || mu <= 0) return false;

  const rx = r.x, ry = r.y, rz = r.z;
  const vx = v.x, vy = v.y, vz = v.z;
  const rMag = Math.hypot(rx, ry, rz);
  const vSq = vx * vx + vy * vy + vz * vz;
  if (rMag === 0 || vSq === 0) return false;

  // Specific orbital energy ε = v²/2 − µ/r. Bound orbits have ε < 0;
  // semi-major axis a = −µ/(2ε) is then positive and finite.
  const energy = vSq / 2 - mu / rMag;
  if (energy >= 0) return false;
  const a = -mu / (2 * energy);

  // Specific angular momentum h⃗ = r⃗ × v⃗. Defines the orbital plane.
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const hMag = Math.hypot(hx, hy, hz);
  if (hMag === 0) return false; // r ‖ v — radial trajectory, no orbit plane.

  // Eccentricity vector e⃗ = (v⃗ × h⃗)/µ − r̂. Magnitude = eccentricity,
  // direction points from focus (parent body) to periapsis.
  const vCrossHx = vy * hz - vz * hy;
  const vCrossHy = vz * hx - vx * hz;
  const vCrossHz = vx * hy - vy * hx;
  const ecx = vCrossHx / mu - rx / rMag;
  const ecy = vCrossHy / mu - ry / rMag;
  const ecz = vCrossHz / mu - rz / rMag;
  const e = Math.hypot(ecx, ecy, ecz);

  // Build the orbital-plane basis. ê_x = periapsis direction; for a
  // near-circular orbit (e≈0) the periapsis direction is undefined, so
  // fall back to r̂ — visually arbitrary but stable, orthogonal to ê_z,
  // and lies in the orbital plane by construction.
  const E_THRESHOLD = 1e-10;
  if (e > E_THRESHOLD) {
    const inv = 1 / e;
    scratch.exHat.x = ecx * inv;
    scratch.exHat.y = ecy * inv;
    scratch.exHat.z = ecz * inv;
  } else {
    const inv = 1 / rMag;
    scratch.exHat.x = rx * inv;
    scratch.exHat.y = ry * inv;
    scratch.exHat.z = rz * inv;
  }

  // ê_y = ĥ × ê_x (right-handed in-plane perpendicular). Computed from
  // the un-normalised h⃗ then normalised once at the end — equivalent
  // and cheaper than normalising ĥ first.
  const eyXraw = hy * scratch.exHat.z - hz * scratch.exHat.y;
  const eyYraw = hz * scratch.exHat.x - hx * scratch.exHat.z;
  const eyZraw = hx * scratch.exHat.y - hy * scratch.exHat.x;
  const eyMagInv = 1 / Math.hypot(eyXraw, eyYraw, eyZraw);
  scratch.eyHat.x = eyXraw * eyMagInv;
  scratch.eyHat.y = eyYraw * eyMagInv;
  scratch.eyHat.z = eyZraw * eyMagInv;

  // Semi-minor axis. ε < 0 above guarantees e < 1, so 1−e² > 0.
  const b = a * Math.sqrt(1 - e * e);
  // Distance from ellipse centre to focus (parent), measured along ê_x.
  // Parametric ellipse coords are centre-relative; subtract `ae` so the
  // resulting points are focus-relative (matches r⃗ in the input).
  const ae = a * e;

  const dE = TWO_PI / segments;
  for (let k = 0; k < segments; k++) {
    const E = k * dE;
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    // E=0  → (a−ae, 0) = periapsis (closest to focus, on ê_x side).
    // E=π  → (−a−ae, 0) = apoapsis (farthest from focus).
    const xLocal = a * cosE - ae;
    const yLocal = b * sinE;

    const idx = k * 3;
    out[idx]     = scratch.exHat.x * xLocal + scratch.eyHat.x * yLocal;
    out[idx + 1] = scratch.exHat.y * xLocal + scratch.eyHat.y * yLocal;
    out[idx + 2] = scratch.exHat.z * xLocal + scratch.eyHat.z * yLocal;
  }

  return true;
}
