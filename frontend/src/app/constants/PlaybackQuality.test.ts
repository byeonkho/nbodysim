import { describe, expect, it } from "vitest";
import {
  BUCKET_LABELS,
  FIDELITY_BUCKETS,
  INTEGRATOR_DEFAULT_BUCKETS,
  K_BY_BUCKET,
  N_BY_BUCKET,
  type FidelityBucket,
} from "./PlaybackQuality";

describe("FIDELITY_BUCKETS", () => {
  it("has the 4 expected wire names in low → high order", () => {
    // Must match backend FidelityBucket enum wireName values exactly.
    expect(FIDELITY_BUCKETS).toEqual([
      "low",
      "medLow",
      "medium",
      "medHigh",
    ]);
  });

  it("every bucket has a non-empty label", () => {
    for (const bucket of FIDELITY_BUCKETS) {
      expect(BUCKET_LABELS[bucket].length).toBeGreaterThan(0);
    }
  });
});

describe("K_BY_BUCKET", () => {
  it("mirrors backend FidelityBucket K values (design doc table)", () => {
    expect(K_BY_BUCKET).toEqual({
      low: 20,
      medLow: 10,
      medium: 5,
      medHigh: 2,
    });
  });

  it("K values decrease monotonically as quality bucket ascends", () => {
    const ks = FIDELITY_BUCKETS.map((b) => K_BY_BUCKET[b]);
    for (let i = 1; i < ks.length; i++) {
      expect(ks[i]).toBeLessThan(ks[i - 1]);
    }
  });
});

describe("N_BY_BUCKET", () => {
  it("mirrors backend FidelityBucket N values (design doc table)", () => {
    expect(N_BY_BUCKET).toEqual({
      low: 3000,
      medLow: 5000,
      medium: 7500,
      medHigh: 10000,
    });
  });

  it("N values increase monotonically as quality bucket ascends", () => {
    const ns = FIDELITY_BUCKETS.map((b) => N_BY_BUCKET[b]);
    for (let i = 1; i < ns.length; i++) {
      expect(ns[i]).toBeGreaterThan(ns[i - 1]);
    }
  });
});

describe("INTEGRATOR_DEFAULT_BUCKETS", () => {
  it("matches backend FidelityBucket.defaultFor() — drift here means UI shows wrong active bucket on first open", () => {
    expect(INTEGRATOR_DEFAULT_BUCKETS).toEqual({
      euler: "medHigh",
      rk4: "medLow",
      dp853: "low",
    });
  });

  it("every default is a valid bucket key", () => {
    const valid = new Set<FidelityBucket>(FIDELITY_BUCKETS);
    for (const bucket of Object.values(INTEGRATOR_DEFAULT_BUCKETS)) {
      expect(valid.has(bucket)).toBe(true);
    }
  });

  it("covers the three integrators the form exposes", () => {
    expect(INTEGRATOR_DEFAULT_BUCKETS).toHaveProperty("euler");
    expect(INTEGRATOR_DEFAULT_BUCKETS).toHaveProperty("rk4");
    expect(INTEGRATOR_DEFAULT_BUCKETS).toHaveProperty("dp853");
  });
});
