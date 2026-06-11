import { describe, it, expect } from "vitest";
import { formatSpeed } from "./formatSpeed";

describe("formatSpeed", () => {
  it("2 decimals below 10x", () => expect(formatSpeed(1)).toBe("1.00"));
  it("1 decimal from 10x to 99x", () => expect(formatSpeed(10.5)).toBe("10.5"));
  it("integer at 100x and up", () => expect(formatSpeed(100)).toBe("100"));
  it("handles non-finite", () => expect(formatSpeed(NaN)).toBe("0.00"));
});
