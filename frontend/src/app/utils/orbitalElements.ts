import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

// Standard Keplerian orbital elements computed from a body's instantaneous
// state vector (r, v) relative to the central body it orbits, plus the
// central body's gravitational parameter µ.
//
// Inputs MUST be raw ICRF values in metres and m/s — the rendering-only
// Y/Z swap from coordinates.ts is NOT applied here. Physics doesn't care
// about the three.js Y-up convention.
//
// Reference: Vallado, "Fundamentals of Astrodynamics and Applications",
// algorithm RV2COE. Standard textbook formulation; not optimized for
// hot-path use (called at the body-card refresh rate, ~5 Hz).
//
// For planets, the central body is the Sun and µ is GM_sun. For the Moon,
// the central body is Earth and µ is GM_earth. The frontend slice carries
// µ per-body in CelestialBodyProperties; the body card looks up the
// orbitingBody's µ before calling here.

export interface OrbitalElements {
  // Semi-major axis (m). Negative for hyperbolic orbits — UI should display
  // "hyperbolic" rather than a negative number in that case.
  semiMajorAxis: number;
  // Eccentricity (dimensionless). 0 = circular, <1 elliptical, =1 parabolic,
  // >1 hyperbolic.
  eccentricity: number;
  // Inclination (radians) relative to the ICRF reference plane (~ecliptic
  // for heliocentric orbits, equator-of-J2000 strictly speaking).
  inclination: number;
  // True anomaly (radians, [0, 2π)) — angle from periapsis to current
  // position, measured in the orbital plane.
  trueAnomaly: number;
  // Orbital period (seconds). NaN for unbound orbits (e ≥ 1).
  period: number;
}

const TWO_PI = Math.PI * 2;

function magnitude(v: Vector3Simple): number {
  return Math.hypot(v.x, v.y, v.z);
}

function dot(a: Vector3Simple, b: Vector3Simple): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3Simple, b: Vector3Simple): Vector3Simple {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function subtract(a: Vector3Simple, b: Vector3Simple): Vector3Simple {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function clampToUnit(x: number): number {
  // Floating-point arithmetic occasionally produces values like 1.0000000002
  // which acos() returns NaN for. Clamp to ±1 before trig.
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}

/**
 * Compute Keplerian orbital elements for a body relative to the central body
 * it orbits. Pass heliocentric state vectors for both — the function does
 * the relative-state subtraction internally.
 *
 * Returns null if µ ≤ 0 (unknown) or the inputs degenerate (zero radius /
 * velocity, parallel r and v leading to zero angular momentum). UI treats
 * null as "elements unavailable" rather than rendering NaNs.
 */
export function computeOrbitalElements(
  bodyPosition: Vector3Simple,
  bodyVelocity: Vector3Simple,
  centralPosition: Vector3Simple,
  centralVelocity: Vector3Simple,
  centralMu: number,
): OrbitalElements | null {
  if (!Number.isFinite(centralMu) || centralMu <= 0) return null;

  const r = subtract(bodyPosition, centralPosition);
  const v = subtract(bodyVelocity, centralVelocity);

  const rMag = magnitude(r);
  const vMag = magnitude(v);
  if (rMag === 0 || vMag === 0) return null;

  // Specific angular momentum h⃗ = r⃗ × v⃗.
  const h = cross(r, v);
  const hMag = magnitude(h);
  if (hMag === 0) return null; // r ‖ v — degenerate, no orbit plane.

  // Specific orbital energy ε = v²/2 − µ/r.
  // For closed orbits (ε < 0), a = −µ/(2ε). For hyperbolic (ε > 0), a < 0.
  const energy = (vMag * vMag) / 2 - centralMu / rMag;
  const semiMajorAxis = -centralMu / (2 * energy);

  // Eccentricity vector e⃗ = (v⃗ × h⃗)/µ − r̂.
  // |e⃗| = e; direction points from focus to periapsis.
  const vCrossH = cross(v, h);
  const eVec: Vector3Simple = {
    x: vCrossH.x / centralMu - r.x / rMag,
    y: vCrossH.y / centralMu - r.y / rMag,
    z: vCrossH.z / centralMu - r.z / rMag,
  };
  const eccentricity = magnitude(eVec);

  // Inclination i = angle between h⃗ and the reference Z axis.
  const inclination = Math.acos(clampToUnit(h.z / hMag));

  // True anomaly ν: angle from periapsis (e⃗ direction) to current r⃗,
  // measured in the orbital plane. Sign of (r⃗ · v⃗) disambiguates
  // ascending vs descending half — positive means moving away from
  // periapsis (0 < ν < π), negative means toward (π < ν < 2π).
  let trueAnomaly: number;
  if (eccentricity > 1e-10) {
    const cosNu = clampToUnit(dot(eVec, r) / (eccentricity * rMag));
    trueAnomaly = Math.acos(cosNu);
    if (dot(r, v) < 0) trueAnomaly = TWO_PI - trueAnomaly;
  } else {
    // Near-circular orbit — eccentricity vector is undefined direction-wise.
    // Fall back to argument of latitude (angle from ascending node), or
    // just from reference X axis if also equatorial. UI will show "—" for
    // ν in this case anyway since it's not physically meaningful.
    trueAnomaly = 0;
  }

  // Orbital period T = 2π · sqrt(a³/µ). Only defined for elliptical orbits;
  // mark as NaN otherwise so the UI can render "—".
  const period =
    semiMajorAxis > 0
      ? TWO_PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / centralMu)
      : NaN;

  return {
    semiMajorAxis,
    eccentricity,
    inclination,
    trueAnomaly,
    period,
  };
}
