import { describe, it, expect } from "vitest";
import { isDesktopTourViewport } from "./useIsMobile";

describe("isDesktopTourViewport", () => {
  it("returns false when width is just below the mobile chrome cutoff (1279, fine pointer)", () => {
    expect(isDesktopTourViewport(1279, false)).toBe(false);
  });

  it("returns true at exactly the mobile chrome cutoff (1280, fine pointer)", () => {
    expect(isDesktopTourViewport(1280, false)).toBe(true);
  });

  it("returns false when pointer is coarse even at the cutoff boundary (1280, coarse pointer)", () => {
    expect(isDesktopTourViewport(1280, true)).toBe(false);
  });

  it("returns false when pointer is coarse on a wide viewport (1400, coarse pointer)", () => {
    expect(isDesktopTourViewport(1400, true)).toBe(false);
  });
});
