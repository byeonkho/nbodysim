import { describe, it, expect } from "vitest";
import { driftMetrics } from "@/app/utils/driftMetrics";

describe("driftMetrics", () => {
  it("returns the straight-line separation in km", () => {
    // 1000 km apart along x (positions in metres).
    const { km } = driftMetrics(
      { x: 1_000_000, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    );
    expect(km).toBeCloseTo(1000, 6);
  });

  it("returns the angular separation in degrees as seen from the origin", () => {
    // Predicted along +x, truth along +y → 90 degrees apart.
    const { angleDeg } = driftMetrics(
      { x: 1.5e11, y: 0, z: 0 },
      { x: 0, y: 1.5e11, z: 0 },
    );
    expect(angleDeg).toBeCloseTo(90, 4);
  });

  it("is zero/zero when the two positions coincide", () => {
    const m = driftMetrics({ x: 1e11, y: 2e10, z: 0 }, { x: 1e11, y: 2e10, z: 0 });
    expect(m.km).toBeCloseTo(0, 6);
    expect(m.angleDeg).toBeCloseTo(0, 6);
  });
});
