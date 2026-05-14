import { describe, expect, it } from "vitest";
import {
  makeOrbitScratch,
  writeOsculatingEllipsePoints,
} from "./osculatingOrbit";

// Companion to orbitalElements.test.ts — that suite locks down scalar
// Keplerian element extraction, this one locks down the geometric ellipse
// sampling that drives OrbitPath rendering. Same physics, different output
// shape.

const AU = 1.495978707e11; // m
const SUN_MU = 1.32712440041e20; // m³/s²
const SEGMENTS = 96;

describe("writeOsculatingEllipsePoints", () => {
  const out = new Float32Array(SEGMENTS * 3);
  const scratch = makeOrbitScratch();

  it("returns false when µ is non-positive or NaN", () => {
    const r = { x: AU, y: 0, z: 0 };
    const v = { x: 0, y: 30000, z: 0 };
    expect(writeOsculatingEllipsePoints(out, SEGMENTS, r, v, 0, scratch)).toBe(
      false,
    );
    expect(
      writeOsculatingEllipsePoints(out, SEGMENTS, r, v, Number.NaN, scratch),
    ).toBe(false);
  });

  it("returns false for unbound (hyperbolic) orbits", () => {
    // v > escape velocity → ε ≥ 0 → no closed ellipse.
    const r = { x: AU, y: 0, z: 0 };
    const vEsc = Math.sqrt((2 * SUN_MU) / AU);
    const v = { x: 0, y: 1.5 * vEsc, z: 0 };
    expect(
      writeOsculatingEllipsePoints(out, SEGMENTS, r, v, SUN_MU, scratch),
    ).toBe(false);
  });

  it("returns false for radial trajectories (r ‖ v)", () => {
    // Falling straight toward the focus — angular momentum is zero, so no
    // orbital plane is defined.
    const r = { x: AU, y: 0, z: 0 };
    const v = { x: -1000, y: 0, z: 0 };
    expect(
      writeOsculatingEllipsePoints(out, SEGMENTS, r, v, SUN_MU, scratch),
    ).toBe(false);
  });

  it("circular orbit produces points of constant radius in the orbital plane", () => {
    // r = (a, 0, 0), v = (0, vc, 0) with vc = sqrt(µ/a) → circle radius a in XY.
    const a = AU;
    const vc = Math.sqrt(SUN_MU / a);
    const ok = writeOsculatingEllipsePoints(
      out,
      SEGMENTS,
      { x: a, y: 0, z: 0 },
      { x: 0, y: vc, z: 0 },
      SUN_MU,
      scratch,
    );
    expect(ok).toBe(true);

    for (let k = 0; k < SEGMENTS; k++) {
      const idx = k * 3;
      const x = out[idx];
      const y = out[idx + 1];
      const z = out[idx + 2];
      // Radius equals a, within float precision on AU magnitudes (~1e11).
      // Float32 carries ~7 digits → tolerable error ~1e4 m = 10 km on AU.
      expect(Math.hypot(x, y, z)).toBeCloseTo(a, -5);
      // Z component stays zero — orbit is in XY plane.
      expect(Math.abs(z)).toBeLessThan(1);
    }
  });

  it("eccentric orbit places periapsis and apoapsis on the periapsis axis", () => {
    // Set the body at periapsis itself (r ⊥ v). With r along +X and v along +Y,
    // the periapsis direction is +X, so E=0 → +X·a(1-e), E=π → -X·a(1+e).
    const a = AU;
    const e = 0.5;
    const rp = a * (1 - e);
    const vp = Math.sqrt((SUN_MU / a) * ((1 + e) / (1 - e)));
    const ok = writeOsculatingEllipsePoints(
      out,
      SEGMENTS,
      { x: rp, y: 0, z: 0 },
      { x: 0, y: vp, z: 0 },
      SUN_MU,
      scratch,
    );
    expect(ok).toBe(true);

    // Periapsis (k=0): focus-relative point at (a(1-e), 0, 0).
    expect(out[0]).toBeCloseTo(a * (1 - e), -5);
    expect(Math.abs(out[1])).toBeLessThan(1);
    expect(Math.abs(out[2])).toBeLessThan(1);

    // Apoapsis (k=segments/2): (-a(1+e), 0, 0).
    const apoIdx = (SEGMENTS / 2) * 3;
    expect(out[apoIdx]).toBeCloseTo(-a * (1 + e), -5);
    expect(Math.abs(out[apoIdx + 1])).toBeLessThan(1);
    expect(Math.abs(out[apoIdx + 2])).toBeLessThan(1);

    // Spot-check: max distance ≈ apoapsis, min ≈ periapsis.
    let maxR = 0;
    let minR = Number.POSITIVE_INFINITY;
    for (let k = 0; k < SEGMENTS; k++) {
      const idx = k * 3;
      const d = Math.hypot(out[idx], out[idx + 1], out[idx + 2]);
      if (d > maxR) maxR = d;
      if (d < minR) minR = d;
    }
    expect(maxR).toBeCloseTo(a * (1 + e), -5);
    expect(minR).toBeCloseTo(a * (1 - e), -5);
  });

  it("inclined circular orbit lies in the tilted plane", () => {
    // Orbit rotated 30° about the X axis: original normal (0,0,1) becomes
    // (0, -sin i, cos i). All sampled points should be perpendicular to
    // that new normal.
    const a = AU;
    const i = (30 * Math.PI) / 180;
    const vc = Math.sqrt(SUN_MU / a);
    const ok = writeOsculatingEllipsePoints(
      out,
      SEGMENTS,
      { x: a, y: 0, z: 0 },
      { x: 0, y: vc * Math.cos(i), z: vc * Math.sin(i) },
      SUN_MU,
      scratch,
    );
    expect(ok).toBe(true);

    const ny = -Math.sin(i);
    const nz = Math.cos(i);
    for (let k = 0; k < SEGMENTS; k++) {
      const idx = k * 3;
      // Plane equation: 0·x + ny·y + nz·z = 0. Tolerance is float32-quantization
      // on AU magnitudes — for a coordinate of magnitude ~1.5e11, Float32Array
      // mantissa resolution is ~1.5e11/2²³ ≈ 18 km per axis, so the dot product
      // can drift by tens of km in the worst case. 50 km (≈3·10⁻⁷ of AU) is
      // well below "visible noise" and well above the float32 noise floor.
      const dot = out[idx + 1] * ny + out[idx + 2] * nz;
      expect(Math.abs(dot)).toBeLessThan(50_000);
      // Radius still = a.
      expect(
        Math.hypot(out[idx], out[idx + 1], out[idx + 2]),
      ).toBeCloseTo(a, -5);
    }
  });
});
