import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import reducer, {
  startTour,
  nextStep,
  prevStep,
  enterAwaitingRun,
  resumePhase2,
  skipTour,
  finishTour,
  readTourSeen,
  type TourState,
} from "./TourSlice";

const initial = { status: "idle" as const, stepIndex: 0 };

describe("TourSlice", () => {
  // The repo runs Vitest in the "node" environment (no jsdom), so stub a
  // minimal window.localStorage for the seen-flag persistence path.
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (m.has(k) ? m.get(k) ?? null : null),
        setItem: (k: string, v: string) => void m.set(k, String(v)),
        removeItem: (k: string) => void m.delete(k),
        clear: () => m.clear(),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts in phase1 at step 0", () => {
    const s = reducer(initial, startTour(undefined));
    expect(s).toEqual({ status: "phase1", stepIndex: 0 });
  });

  it("startTour({atPhase2}) jumps straight to phase2 step 0", () => {
    const s = reducer(initial, startTour({ atPhase2: true }));
    expect(s).toEqual({ status: "phase2", stepIndex: 0 });
  });

  it("nextStep clamps at the end of phase1 (2 steps)", () => {
    let s = reducer(initial, startTour(undefined));
    s = reducer(s, nextStep()); // welcome -> sim-setup
    s = reducer(s, nextStep()); // clamp
    expect(s.stepIndex).toBe(1);
  });

  it("prevStep clamps at 0", () => {
    let s: TourState = { status: "phase2", stepIndex: 0 };
    s = reducer(s, prevStep());
    expect(s.stepIndex).toBe(0);
  });

  it("nextStep clamps at the end of phase2 (5 steps)", () => {
    let s: TourState = { status: "phase2", stepIndex: 0 };
    for (let i = 0; i < 10; i++) s = reducer(s, nextStep());
    expect(s.stepIndex).toBe(4);
  });

  it("enterAwaitingRun then resumePhase2 lands on phase2 step 0", () => {
    let s: TourState = { status: "phase1", stepIndex: 1 };
    s = reducer(s, enterAwaitingRun());
    expect(s.status).toBe("awaitingRun");
    s = reducer(s, resumePhase2());
    expect(s).toEqual({ status: "phase2", stepIndex: 0 });
  });

  it("skipTour and finishTour both end at done and persist seen", () => {
    expect(readTourSeen()).toBe(false);
    let s = reducer({ status: "phase1", stepIndex: 0 }, skipTour());
    expect(s.status).toBe("done");
    expect(readTourSeen()).toBe(true);

    window.localStorage.clear();
    s = reducer({ status: "phase2", stepIndex: 4 }, finishTour());
    expect(s.status).toBe("done");
    expect(readTourSeen()).toBe(true);
  });
});
