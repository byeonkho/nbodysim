import { describe, it, expect } from "vitest";
import { makeIrregularGeometry } from "@/app/utils/irregularGeometry";
import type { ShapeConfig } from "@/app/constants/BodyShapes";

const CFG: ShapeConfig = {
  amplitude: 0.2,
  frequency: 1.6,
  octaves: 4,
  scale: [1.5, 0.8, 0.9],
  seed: 11,
};

describe("makeIrregularGeometry", () => {
  it("is deterministic for a fixed config", () => {
    const a = makeIrregularGeometry(2, [48, 32], CFG).attributes.position.array;
    const b = makeIrregularGeometry(2, [48, 32], CFG).attributes.position.array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces a different shape for a different seed", () => {
    const a = makeIrregularGeometry(2, [48, 32], CFG).attributes.position.array;
    const b = makeIrregularGeometry(2, [48, 32], { ...CFG, seed: 99 }).attributes
      .position.array;
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("keeps every vertex within the configured envelope", () => {
    const radius = 2;
    const geo = makeIrregularGeometry(radius, [48, 32], CFG);
    const pos = geo.attributes.position.array;
    const maxR = radius * (1 + CFG.amplitude);
    const eps = 1e-4;
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i])).toBeLessThanOrEqual(maxR * CFG.scale[0] + eps);
      expect(Math.abs(pos[i + 1])).toBeLessThanOrEqual(maxR * CFG.scale[1] + eps);
      expect(Math.abs(pos[i + 2])).toBeLessThanOrEqual(maxR * CFG.scale[2] + eps);
    }
  });

  it("recomputes normals (unit length)", () => {
    const geo = makeIrregularGeometry(2, [48, 32], CFG);
    const n = geo.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i], n[i + 1], n[i + 2]);
      expect(len).toBeGreaterThan(0.99);
      expect(len).toBeLessThan(1.01);
    }
  });
});
