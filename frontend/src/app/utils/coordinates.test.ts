import { describe, expect, it, vi } from "vitest";
import {
  setBodyWorldPosition,
  writeBodyWorldPositionToArray,
} from "./coordinates";

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
