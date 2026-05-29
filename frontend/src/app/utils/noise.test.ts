import { describe, it, expect } from "vitest";
import { mulberry32, makeSimplex3D, fbm } from "@/app/utils/noise";

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produces different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });

  it("returns values in [0, 1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("makeSimplex3D + fbm", () => {
  it("is deterministic for a fixed seed", () => {
    const n1 = makeSimplex3D(mulberry32(5));
    const n2 = makeSimplex3D(mulberry32(5));
    expect(n1(0.1, 0.2, 0.3)).toEqual(n2(0.1, 0.2, 0.3));
  });

  it("differs across seeds", () => {
    const n1 = makeSimplex3D(mulberry32(5));
    const n2 = makeSimplex3D(mulberry32(6));
    expect(n1(0.1, 0.2, 0.3)).not.toEqual(n2(0.1, 0.2, 0.3));
  });

  it("raw noise stays within ~[-1, 1]", () => {
    const n = makeSimplex3D(mulberry32(9));
    for (let i = 0; i < 300; i++) {
      const v = n(i * 0.37, i * 0.71, i * 1.13);
      expect(v).toBeGreaterThanOrEqual(-1.05);
      expect(v).toBeLessThanOrEqual(1.05);
    }
  });

  it("fbm stays within ~[-1, 1]", () => {
    const n = makeSimplex3D(mulberry32(9));
    for (let i = 0; i < 300; i++) {
      const v = fbm(n, i * 0.37, i * 0.71, i * 1.13, 4);
      expect(v).toBeGreaterThanOrEqual(-1.05);
      expect(v).toBeLessThanOrEqual(1.05);
    }
  });
});
