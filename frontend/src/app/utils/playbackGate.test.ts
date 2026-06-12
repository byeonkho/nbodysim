import { describe, expect, it } from "vitest";
import {
  IDLE_TIMEOUT_MS,
  decideOnVisibilityChange,
  shouldIdlePause,
} from "./playbackGate";

describe("decideOnVisibilityChange", () => {
  it("pauses and takes ownership when the tab hides during playback", () => {
    const decision = decideOnVisibilityChange({
      hidden: true,
      isPaused: false,
      pausedByGate: false,
    });
    expect(decision).toEqual({ action: "pause", pausedByGate: true });
  });

  it("leaves a user-initiated pause alone when the tab hides", () => {
    const decision = decideOnVisibilityChange({
      hidden: true,
      isPaused: true,
      pausedByGate: false,
    });
    expect(decision).toEqual({ action: "none", pausedByGate: false });
  });

  it("resumes on visible only when the gate owns the pause", () => {
    const decision = decideOnVisibilityChange({
      hidden: false,
      isPaused: true,
      pausedByGate: true,
    });
    expect(decision).toEqual({ action: "resume", pausedByGate: false });
  });

  it("does NOT resume a user-initiated pause on visible", () => {
    const decision = decideOnVisibilityChange({
      hidden: false,
      isPaused: true,
      pausedByGate: false,
    });
    expect(decision).toEqual({ action: "none", pausedByGate: false });
  });

  it("keeps gate ownership across duplicate hidden events", () => {
    const decision = decideOnVisibilityChange({
      hidden: true,
      isPaused: true,
      pausedByGate: true,
    });
    expect(decision).toEqual({ action: "none", pausedByGate: true });
  });

  it("releases ownership without action if something else already resumed", () => {
    const decision = decideOnVisibilityChange({
      hidden: false,
      isPaused: false,
      pausedByGate: true,
    });
    expect(decision).toEqual({ action: "none", pausedByGate: false });
  });
});

describe("shouldIdlePause", () => {
  const base = {
    now: 1_000_000 + IDLE_TIMEOUT_MS,
    lastActivityAt: 1_000_000,
    isPaused: false,
    hidden: false,
    isLiveSession: true,
  };

  it("fires once the idle timeout elapses during visible live playback", () => {
    expect(shouldIdlePause(base)).toBe(true);
  });

  it("does not fire before the timeout", () => {
    expect(shouldIdlePause({ ...base, now: base.now - 1 })).toBe(false);
  });

  it("does not fire while paused", () => {
    expect(shouldIdlePause({ ...base, isPaused: true })).toBe(false);
  });

  it("does not fire while hidden (the visibility gate owns that case)", () => {
    expect(shouldIdlePause({ ...base, hidden: true })).toBe(false);
  });

  it("does not fire for sessionless playback (preset clips are free)", () => {
    expect(shouldIdlePause({ ...base, isLiveSession: false })).toBe(false);
  });
});
