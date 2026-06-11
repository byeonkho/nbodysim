import { describe, it, expect } from "vitest";
import { formatAccuracy } from "./formatAccuracy";

describe("formatAccuracy", () => {
  it("renders a small residual as a tiny percent drift", () => {
    expect(formatAccuracy(1e-6)).toBe("0.0001%");
  });
  it("floors extremely small residuals", () => {
    expect(formatAccuracy(1e-12)).toBe("<0.0001%");
  });
  it("uses absolute value (sign-agnostic)", () => {
    expect(formatAccuracy(-1e-6)).toBe("0.0001%");
  });
  it("handles non-finite as a dash", () => {
    expect(formatAccuracy(NaN)).toBe("—");
  });
});
