import { afterEach, describe, expect, it } from "vitest";
import {
  beginLaunch,
  currentLaunchEpoch,
  isCurrentLaunch,
  resetLaunchEpochForTests,
} from "./launchEpoch";

describe("launchEpoch", () => {
  afterEach(() => resetLaunchEpochForTests());

  it("beginLaunch returns a strictly increasing value", () => {
    const a = beginLaunch();
    const b = beginLaunch();
    expect(b).toBeGreaterThan(a);
  });

  it("isCurrentLaunch is true for the latest epoch, false once superseded", () => {
    const e = beginLaunch();
    expect(isCurrentLaunch(e)).toBe(true);
    const e2 = beginLaunch();
    expect(isCurrentLaunch(e)).toBe(false);
    expect(isCurrentLaunch(e2)).toBe(true);
  });

  it("currentLaunchEpoch reflects the last beginLaunch", () => {
    const e = beginLaunch();
    expect(currentLaunchEpoch()).toBe(e);
  });

  it("resetLaunchEpochForTests returns the counter to zero", () => {
    beginLaunch();
    beginLaunch();
    resetLaunchEpochForTests();
    expect(currentLaunchEpoch()).toBe(0);
  });
});
