import { describe, expect, it } from "vitest";
import { findEarthIndex, writePivotInto } from "./framePivot";
import type { CelestialBody } from "@/app/store/slices/SimulationSlice";

function makeBody(name: string, x: number, y: number, z: number): CelestialBody {
  return {
    name,
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
  };
}

describe("findEarthIndex", () => {
  it("finds Earth case-insensitively", () => {
    const snapshot = [
      makeBody("Sun", 0, 0, 0),
      makeBody("earth", 1, 2, 3),
      makeBody("Mars", 4, 5, 6),
    ];
    expect(findEarthIndex(snapshot)).toBe(1);
  });

  it("returns -1 when Earth is absent", () => {
    const snapshot = [makeBody("Sun", 0, 0, 0), makeBody("Mars", 1, 2, 3)];
    expect(findEarthIndex(snapshot)).toBe(-1);
  });

  it("trims whitespace before matching", () => {
    const snapshot = [makeBody("  Earth  ", 1, 2, 3)];
    expect(findEarthIndex(snapshot)).toBe(0);
  });
});

describe("writePivotInto", () => {
  const out = { x: 999, y: 999, z: 999 }; // sentinel — confirms write happens

  it("writes zero pivot for helio frame", () => {
    out.x = 999; out.y = 999; out.z = 999;
    writePivotInto(out, [makeBody("Earth", 1, 2, 3)], "helio", 0);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("writes Earth's position for geo frame", () => {
    out.x = 999; out.y = 999; out.z = 999;
    const snapshot = [
      makeBody("Sun", 0, 0, 0),
      makeBody("Earth", 1.5e11, 0, 0),
      makeBody("Moon", 1.5e11 + 3.84e8, 0, 0),
    ];
    writePivotInto(out, snapshot, "geo", 1);
    expect(out).toEqual({ x: 1.5e11, y: 0, z: 0 });
  });

  it("falls back to zero pivot when earthIdx is -1 (Earth absent)", () => {
    out.x = 999; out.y = 999; out.z = 999;
    writePivotInto(out, [makeBody("Sun", 0, 0, 0)], "geo", -1);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("falls back to zero pivot when earthIdx is out of bounds", () => {
    // Defensive: a stale cached earthIdx after a body-list change shouldn't
    // crash or read OOB — degrade to helio rather than throw.
    out.x = 999; out.y = 999; out.z = 999;
    writePivotInto(out, [makeBody("Sun", 0, 0, 0)], "geo", 5);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("mutates the same `out` reference across calls (no allocation)", () => {
    // The hot-path contract: `out` is reused across frames; no fresh
    // Vector3Simple should be returned. Confirm by holding a stable ref.
    const reused = { x: 0, y: 0, z: 0 };
    const snapshotA = [makeBody("Earth", 1, 2, 3)];
    const snapshotB = [makeBody("Earth", 4, 5, 6)];

    writePivotInto(reused, snapshotA, "geo", 0);
    expect(reused).toEqual({ x: 1, y: 2, z: 3 });

    writePivotInto(reused, snapshotB, "geo", 0);
    expect(reused).toEqual({ x: 4, y: 5, z: 6 });
    // Same object identity — no allocation.
  });
});
