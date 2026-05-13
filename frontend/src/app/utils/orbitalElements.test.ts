import { describe, expect, it } from "vitest";
import { computeOrbitalElements } from "./orbitalElements";

// Earth's orbit. The reference values are textbook (Vallado / NASA fact
// sheet) and the state vector is constructed analytically to produce them
// exactly — easier to reason about than using a JPL state vector and
// chasing precision gremlins. These tests prove the algorithm matches the
// canonical RV2COE formulation.

const AU = 1.495978707e11; // metres
const SUN_MU = 1.32712440041e20; // m³/s²
const EARTH_MU = 3.986004418e14; // m³/s²

describe("computeOrbitalElements", () => {
  it("returns null when µ is unknown or non-positive", () => {
    const r = { x: AU, y: 0, z: 0 };
    const v = { x: 0, y: 30000, z: 0 };
    expect(
      computeOrbitalElements(r, v, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0),
    ).toBeNull();
    expect(
      computeOrbitalElements(
        r,
        v,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        Number.NaN,
      ),
    ).toBeNull();
  });

  it("returns null for degenerate inputs (zero radius)", () => {
    expect(
      computeOrbitalElements(
        { x: 0, y: 0, z: 0 },
        { x: 30000, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        SUN_MU,
      ),
    ).toBeNull();
  });

  it("computes a circular equatorial orbit correctly", () => {
    // Body at (a, 0, 0) with circular velocity v_c = sqrt(µ/a) in +Y direction.
    // Expected: a = a, e = 0, i = 0, period = 2π·sqrt(a³/µ).
    const a = AU;
    const vc = Math.sqrt(SUN_MU / a);
    const elements = computeOrbitalElements(
      { x: a, y: 0, z: 0 },
      { x: 0, y: vc, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      SUN_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.semiMajorAxis).toBeCloseTo(a, -3); // within km on AU scale
    expect(elements.eccentricity).toBeLessThan(1e-10);
    expect(elements.inclination).toBeLessThan(1e-10);
    // Period for circular orbit at 1 AU around the Sun ≈ 1 year = 365.25 days.
    const expectedPeriod = 2 * Math.PI * Math.sqrt((a * a * a) / SUN_MU);
    expect(elements.period).toBeCloseTo(expectedPeriod, -3);
    expect(elements.period / 86400).toBeCloseTo(365.25, 0);
  });

  it("computes eccentricity correctly for an elliptical orbit", () => {
    // Periapsis state: r = a(1-e), v = sqrt(µ/a · (1+e)/(1-e)). At periapsis,
    // r ⊥ v so the geometry is clean. Use e = 0.5.
    const a = AU;
    const e = 0.5;
    const rp = a * (1 - e);
    const vp = Math.sqrt((SUN_MU / a) * ((1 + e) / (1 - e)));
    const elements = computeOrbitalElements(
      { x: rp, y: 0, z: 0 },
      { x: 0, y: vp, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      SUN_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.semiMajorAxis).toBeCloseTo(a, -3);
    expect(elements.eccentricity).toBeCloseTo(e, 10);
    // At periapsis, true anomaly is 0.
    expect(elements.trueAnomaly).toBeLessThan(1e-6);
  });

  it("computes inclination for a tilted orbit", () => {
    // Construct a circular orbit in a plane inclined 30° from the XY plane.
    // Velocity rotated about the X axis by 30°: v = (0, vc·cos(i), vc·sin(i)).
    // The orbit's normal is then tilted by i, so inclination = i.
    const a = AU;
    const i = (30 * Math.PI) / 180;
    const vc = Math.sqrt(SUN_MU / a);
    const elements = computeOrbitalElements(
      { x: a, y: 0, z: 0 },
      { x: 0, y: vc * Math.cos(i), z: vc * Math.sin(i) },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      SUN_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.inclination).toBeCloseTo(i, 10);
  });

  it("uses relative state vectors for non-origin central body", () => {
    // Place the central body off-origin and put the body in a 1-AU circular
    // orbit *around it*. Elements should match the origin-centered case.
    const a = AU;
    const vc = Math.sqrt(SUN_MU / a);
    const central = { x: 7e11, y: -3e11, z: 1e10 };
    const centralVel = { x: 1000, y: 2000, z: 0 };
    const elements = computeOrbitalElements(
      { x: central.x + a, y: central.y, z: central.z },
      { x: centralVel.x, y: centralVel.y + vc, z: centralVel.z },
      central,
      centralVel,
      SUN_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.semiMajorAxis).toBeCloseTo(a, -3);
    expect(elements.eccentricity).toBeLessThan(1e-10);
  });

  it("Moon around Earth at typical lunar parameters", () => {
    // Sanity check at a different µ/scale combo. Lunar semi-major axis is
    // ~384 400 km; period ~27.3 days. Use a circular approximation around
    // Earth's µ alone (true 2-body period uses µ_earth + µ_moon ≈ 1.012 ×
    // µ_earth so this is ~0.6% high, hence the wide tolerance — the value
    // we check matters less than the algorithm shape, which the cleaner
    // tests above lock down exactly).
    const a = 384_400_000; // m
    const vc = Math.sqrt(EARTH_MU / a);
    const elements = computeOrbitalElements(
      { x: a, y: 0, z: 0 },
      { x: 0, y: vc, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      EARTH_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.semiMajorAxis).toBeCloseTo(a, -3);
    // Within 1 day of 27.3 — circular-µ_earth-only approximation.
    expect(elements.period / 86400).toBeGreaterThan(26.5);
    expect(elements.period / 86400).toBeLessThan(28);
  });

  it("flags hyperbolic orbits with negative semi-major axis and NaN period", () => {
    // Velocity above escape velocity: v_esc = sqrt(2µ/r). Pick v = 1.5·v_esc.
    const r = AU;
    const vEsc = Math.sqrt((2 * SUN_MU) / r);
    const elements = computeOrbitalElements(
      { x: r, y: 0, z: 0 },
      { x: 0, y: 1.5 * vEsc, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      SUN_MU,
    );
    expect(elements).not.toBeNull();
    if (!elements) return;
    expect(elements.semiMajorAxis).toBeLessThan(0);
    expect(elements.eccentricity).toBeGreaterThan(1);
    expect(Number.isNaN(elements.period)).toBe(true);
  });
});
