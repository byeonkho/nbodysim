import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setBodyWorldPosition,
  setBodyWorldPositionWithPreset,
  writeBodyWorldPositionToArray,
  writeBodyWorldPositionToArrayWithPreset,
} from "./coordinates";
import { setDevSetting } from "@/app/dev/devSettingsStore";
import { DEFAULT_LOG_SCALE_A, REALISTIC_DIVISOR } from "@/app/utils/scalePipeline";

// Pins the ICRF → three.js coordinate mapping. Drift here is silent —
// the scene would simply render the orbital plane in the wrong
// orientation, no crash, no test failure outside of these assertions.
//
// Contract: backend body coords (ICRF, ecliptic ≈ XY plane, Z = celestial
// north pole) get mapped to three.js (Y-up, ecliptic = XZ plane) via
//   world.x = body.x      (in-plane left/right)
//   world.y = body.z      (small ecliptic-tilt vertical wobble)
//   world.z = body.y      (in-plane forward/back)

describe("setBodyWorldPosition", () => {
  it("swaps Y and Z when mapping ICRF body coords to three.js world", () => {
    const target = { set: vi.fn() };
    setBodyWorldPosition(target, { x: 100, y: 200, z: 50 }, 1);
    expect(target.set).toHaveBeenCalledWith(100, 50, 200);
  });

  it("divides every component by the scale", () => {
    const target = { set: vi.fn() };
    setBodyWorldPosition(target, { x: 100, y: 200, z: 50 }, 10);
    expect(target.set).toHaveBeenCalledWith(10, 5, 20);
  });

  it("handles negative coordinates without sign flips", () => {
    const target = { set: vi.fn() };
    setBodyWorldPosition(target, { x: -1, y: -2, z: -3 }, 1);
    expect(target.set).toHaveBeenCalledWith(-1, -3, -2);
  });

  it("handles the origin", () => {
    const target = { set: vi.fn() };
    setBodyWorldPosition(target, { x: 0, y: 0, z: 0 }, 1);
    expect(target.set).toHaveBeenCalledWith(0, 0, 0);
  });
});

describe("writeBodyWorldPositionToArray", () => {
  it("writes the swapped triple at the given offset", () => {
    const out = new Float32Array(9);
    writeBodyWorldPositionToArray(out, 3, { x: 100, y: 200, z: 50 }, 1);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(100);
    expect(out[4]).toBe(50);
    expect(out[5]).toBe(200);
    expect(out[6]).toBe(0);
  });

  it("scales every component", () => {
    const out = new Float32Array(3);
    writeBodyWorldPositionToArray(out, 0, { x: 100, y: 200, z: 50 }, 10);
    expect(Array.from(out)).toEqual([10, 5, 20]);
  });

  it("agrees with setBodyWorldPosition for the same input", () => {
    // Lockstep check: if the two helpers ever drift, this catches it.
    const captured = vi.fn();
    setBodyWorldPosition({ set: captured }, { x: 7, y: 11, z: 13 }, 2);
    const setArgs = captured.mock.calls[0];

    const arr = new Float32Array(3);
    writeBodyWorldPositionToArray(arr, 0, { x: 7, y: 11, z: 13 }, 2);
    expect(Array.from(arr)).toEqual(setArgs);
  });
});

// ----------------------------------------------------------------
// Pipeline-aware helpers — contract pins:
//   - Realistic preset behaves identically to setBodyWorldPosition(scale=1e8)
//   - Log preset compresses large distances (smaller magnitude output)
//   - Y/Z swap is preserved in both presets
//   - Degenerate input (0,0,0) writes zeros, no NaN
//   - setBodyWorldPositionWithPreset and writeBodyWorldPositionToArrayWithPreset stay in lockstep
// ----------------------------------------------------------------

beforeEach(() => {
  setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
  setDevSetting("logScaleRRef", 149_597_870_700);
  setDevSetting("logRadiusExponent", 0.55);
});

describe("setBodyWorldPositionWithPreset", () => {
  it("realistic preset matches setBodyWorldPosition with scale=1e8", () => {
    const body = { x: 1_000_000_000, y: 2_000_000_000, z: 500_000_000 };

    const legacyCaptured = vi.fn();
    setBodyWorldPosition({ set: legacyCaptured }, body, REALISTIC_DIVISOR);
    const [lx, ly, lz] = legacyCaptured.mock.calls[0];

    const pipelineCaptured = vi.fn();
    setBodyWorldPositionWithPreset({ set: pipelineCaptured }, body, "realistic");
    const [px, py, pz] = pipelineCaptured.mock.calls[0];

    expect(px).toBeCloseTo(lx, 10);
    expect(py).toBeCloseTo(ly, 10);
    expect(pz).toBeCloseTo(lz, 10);
  });

  it("log preset produces smaller world-unit magnitude than realistic at AU-scale", () => {
    // 1 AU = ~1.5e11 m. Realistic divides by 1e8 → 1500 wu.
    // Log compresses to A * log10(1 + r/r_ref) → ~60 * log10(2) ≈ 18 wu.
    const body = { x: 149_597_870_700, y: 0, z: 0 };

    const realisticCaptured = vi.fn();
    setBodyWorldPositionWithPreset({ set: realisticCaptured }, body, "realistic");
    const [rx] = realisticCaptured.mock.calls[0];

    const logCaptured = vi.fn();
    setBodyWorldPositionWithPreset({ set: logCaptured }, body, "log");
    const [lx] = logCaptured.mock.calls[0];

    expect(Math.abs(lx)).toBeLessThan(Math.abs(rx));
  });

  it("preserves Y/Z swap for a body along ICRF X axis", () => {
    // Body at (1, 0, 0) m: world.x non-zero, world.y/world.z zero.
    const captured = vi.fn();
    setBodyWorldPositionWithPreset({ set: captured }, { x: 1, y: 0, z: 0 }, "realistic");
    const [wx, wy, wz] = captured.mock.calls[0];
    expect(wx).not.toBe(0);
    expect(wy).toBe(0);
    expect(wz).toBe(0);
  });

  it("preserves Y/Z swap: ICRF Y maps to world Z, ICRF Z maps to world Y", () => {
    // Body at (0, 1, 0) m in ICRF → (world.x=0, world.y=0, world.z≠0)
    // Body at (0, 0, 1) m in ICRF → (world.x=0, world.y≠0, world.z=0)
    const capturedY = vi.fn();
    setBodyWorldPositionWithPreset({ set: capturedY }, { x: 0, y: 1, z: 0 }, "realistic");
    const [, wy_fromY, wz_fromY] = capturedY.mock.calls[0];
    expect(wy_fromY).toBe(0);
    expect(wz_fromY).not.toBe(0);

    const capturedZ = vi.fn();
    setBodyWorldPositionWithPreset({ set: capturedZ }, { x: 0, y: 0, z: 1 }, "realistic");
    const [, wy_fromZ, wz_fromZ] = capturedZ.mock.calls[0];
    expect(wy_fromZ).not.toBe(0);
    expect(wz_fromZ).toBe(0);
  });

  it("degenerate input (0,0,0) writes zeros without NaN", () => {
    const captured = vi.fn();
    setBodyWorldPositionWithPreset({ set: captured }, { x: 0, y: 0, z: 0 }, "realistic");
    const [x, y, z] = captured.mock.calls[0];
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });

  it("degenerate input (0,0,0) writes zeros without NaN for log preset", () => {
    const captured = vi.fn();
    setBodyWorldPositionWithPreset({ set: captured }, { x: 0, y: 0, z: 0 }, "log");
    const [x, y, z] = captured.mock.calls[0];
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });
});

describe("writeBodyWorldPositionToArrayWithPreset", () => {
  it("realistic preset matches writeBodyWorldPositionToArray with scale=1e8", () => {
    const body = { x: 1_000_000_000, y: 2_000_000_000, z: 500_000_000 };

    const legacy = new Float64Array(3);
    writeBodyWorldPositionToArray(legacy, 0, body, REALISTIC_DIVISOR);

    const pipeline = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(pipeline, 0, body, "realistic");

    expect(pipeline[0]).toBeCloseTo(legacy[0], 10);
    expect(pipeline[1]).toBeCloseTo(legacy[1], 10);
    expect(pipeline[2]).toBeCloseTo(legacy[2], 10);
  });

  it("log preset produces smaller world-unit magnitude than realistic at AU-scale", () => {
    const body = { x: 149_597_870_700, y: 0, z: 0 };

    const realistic = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(realistic, 0, body, "realistic");

    const log = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(log, 0, body, "log");

    expect(Math.abs(log[0])).toBeLessThan(Math.abs(realistic[0]));
  });

  it("writes at the correct offset, leaving surrounding slots untouched", () => {
    const body = { x: 1_000_000_000, y: 2_000_000_000, z: 500_000_000 };
    const out = new Float32Array(9);
    writeBodyWorldPositionToArrayWithPreset(out, 3, body, "realistic");
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).not.toBe(0);
    expect(out[6]).toBe(0);
  });

  it("preserves Y/Z swap: ICRF Y → slot+2, ICRF Z → slot+1", () => {
    // Body at (0, 1, 0): world.z (slot+2) non-zero, world.y (slot+1) zero
    const outY = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(outY, 0, { x: 0, y: 1, z: 0 }, "realistic");
    expect(outY[1]).toBe(0);      // world Y = ICRF Z component
    expect(outY[2]).not.toBe(0);  // world Z = ICRF Y component

    // Body at (0, 0, 1): world.y (slot+1) non-zero, world.z (slot+2) zero
    const outZ = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(outZ, 0, { x: 0, y: 0, z: 1 }, "realistic");
    expect(outZ[1]).not.toBe(0);
    expect(outZ[2]).toBe(0);
  });

  it("degenerate input (0,0,0) writes zeros without NaN", () => {
    const out = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(out, 0, { x: 0, y: 0, z: 0 }, "realistic");
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it("degenerate input (0,0,0) writes zeros without NaN for log preset", () => {
    const out = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(out, 0, { x: 0, y: 0, z: 0 }, "log");
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it("stays in lockstep with setBodyWorldPositionWithPreset for the same input", () => {
    // Contract check: if the two helpers drift, this fails first.
    const body = { x: 7_000_000_000, y: 11_000_000_000, z: 13_000_000_000 };

    const captured = vi.fn();
    setBodyWorldPositionWithPreset({ set: captured }, body, "realistic");
    const [sx, sy, sz] = captured.mock.calls[0];

    const arr = new Float64Array(3);
    writeBodyWorldPositionToArrayWithPreset(arr, 0, body, "realistic");

    expect(arr[0]).toBeCloseTo(sx, 10);
    expect(arr[1]).toBeCloseTo(sy, 10);
    expect(arr[2]).toBeCloseTo(sz, 10);
  });
});
