import { describe, expect, it } from "vitest";
import { findEarthBodyIndex, writePivotInto } from "./framePivot";
import { createChunkBuffer, type ChunkBuffer } from "@/app/store/chunkBuffer";

// Build a single-timestep ChunkBuffer with the given body positions for
// pivot-resolution tests. velocity slots stay 0 (irrelevant to pivot logic).
function makeBuffer(
  bodies: Array<{ name: string; x: number; y: number; z: number }>,
): ChunkBuffer {
  const buf = createChunkBuffer(
    bodies.map((b) => b.name),
    1,
  );
  for (let i = 0; i < bodies.length; i++) {
    const base = i * 6;
    buf.positions[base] = bodies[i].x;
    buf.positions[base + 1] = bodies[i].y;
    buf.positions[base + 2] = bodies[i].z;
  }
  buf.totalTimesteps = 1;
  return buf;
}

describe("findEarthBodyIndex", () => {
  it("finds Earth case-insensitively", () => {
    const buf = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "earth", x: 1, y: 2, z: 3 },
      { name: "Mars", x: 4, y: 5, z: 6 },
    ]);
    expect(findEarthBodyIndex(buf)).toBe(1);
  });

  it("returns -1 when Earth is absent", () => {
    const buf = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "Mars", x: 1, y: 2, z: 3 },
    ]);
    expect(findEarthBodyIndex(buf)).toBe(-1);
  });

  it("trims whitespace before matching", () => {
    const buf = makeBuffer([{ name: "  Earth  ", x: 1, y: 2, z: 3 }]);
    expect(findEarthBodyIndex(buf)).toBe(0);
  });
});

describe("findEarthBodyIndex caching", () => {
  it("does not rescan the name map for the same buffer object", () => {
    const buf = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "Earth", x: 7, y: 8, z: 9 },
    ]);
    expect(findEarthBodyIndex(buf)).toBe(1);
    // Mutate the map underneath. Within one buffer identity the body set is
    // immutable by contract (created once per session, appended in place),
    // so the cached slot must keep winning. This proves the scan didn't rerun.
    buf.bodyNameToIndex.clear();
    expect(findEarthBodyIndex(buf)).toBe(1);
  });

  it("re-resolves for a new buffer object (new simulation)", () => {
    const bufA = makeBuffer([
      { name: "Earth", x: 1, y: 2, z: 3 },
      { name: "Mars", x: 4, y: 5, z: 6 },
    ]);
    const bufB = makeBuffer([
      { name: "Mars", x: 4, y: 5, z: 6 },
      { name: "Earth", x: 1, y: 2, z: 3 },
    ]);
    expect(findEarthBodyIndex(bufA)).toBe(0);
    expect(findEarthBodyIndex(bufB)).toBe(1);
  });

  it("caches the Earth-absent result (-1) too", () => {
    const buf = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "Mars", x: 1, y: 2, z: 3 },
    ]);
    expect(findEarthBodyIndex(buf)).toBe(-1);
    // Adding Earth to the same buffer object must NOT be picked up: the miss
    // is cached. Real buffers never gain bodies mid-session.
    buf.bodyNameToIndex.set("Earth", 0);
    expect(findEarthBodyIndex(buf)).toBe(-1);
    // A fresh buffer object resolves it.
    const buf2 = makeBuffer([{ name: "Earth", x: 1, y: 2, z: 3 }]);
    expect(findEarthBodyIndex(buf2)).toBe(0);
  });

  it("writePivotInto in geo mode follows the cache across buffer identities", () => {
    const out = { x: 999, y: 999, z: 999 };
    const bufA = makeBuffer([{ name: "Earth", x: 1, y: 2, z: 3 }]);
    const bufB = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "Earth", x: 4, y: 5, z: 6 },
    ]);
    writePivotInto(out, bufA, 0, "geo");
    expect(out).toEqual({ x: 1, y: 2, z: 3 });
    writePivotInto(out, bufB, 0, "geo");
    expect(out).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe("writePivotInto", () => {
  const out = { x: 999, y: 999, z: 999 };

  it("writes zero pivot for helio frame", () => {
    out.x = 999; out.y = 999; out.z = 999;
    const buf = makeBuffer([{ name: "Earth", x: 1, y: 2, z: 3 }]);
    writePivotInto(out, buf, 0, "helio");
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("writes Earth's position for geo frame", () => {
    out.x = 999; out.y = 999; out.z = 999;
    const buf = makeBuffer([
      { name: "Sun", x: 0, y: 0, z: 0 },
      { name: "Earth", x: 1.5e11, y: 0, z: 0 },
      { name: "Moon", x: 1.5e11 + 3.84e8, y: 0, z: 0 },
    ]);
    writePivotInto(out, buf, 0, "geo");
    expect(out).toEqual({ x: 1.5e11, y: 0, z: 0 });
  });

  it("falls back to zero pivot when Earth is absent in geo mode", () => {
    out.x = 999; out.y = 999; out.z = 999;
    const buf = makeBuffer([{ name: "Sun", x: 0, y: 0, z: 0 }]);
    writePivotInto(out, buf, 0, "geo");
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("falls back to zero pivot when buffer is null", () => {
    out.x = 999; out.y = 999; out.z = 999;
    writePivotInto(out, null, 0, "geo");
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("falls back to zero pivot when timestepIdx is out of range", () => {
    out.x = 999; out.y = 999; out.z = 999;
    const buf = makeBuffer([{ name: "Earth", x: 1, y: 2, z: 3 }]);
    writePivotInto(out, buf, 5, "geo");
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("mutates the same `out` reference across calls (no allocation)", () => {
    const reused = { x: 0, y: 0, z: 0 };
    const bufA = makeBuffer([{ name: "Earth", x: 1, y: 2, z: 3 }]);
    const bufB = makeBuffer([{ name: "Earth", x: 4, y: 5, z: 6 }]);

    writePivotInto(reused, bufA, 0, "geo");
    expect(reused).toEqual({ x: 1, y: 2, z: 3 });

    writePivotInto(reused, bufB, 0, "geo");
    expect(reused).toEqual({ x: 4, y: 5, z: 6 });
  });
});
