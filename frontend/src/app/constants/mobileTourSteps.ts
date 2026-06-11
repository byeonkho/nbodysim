// Step definitions + copy for the mobile intro tour. Pure data, no DOM. Plain
// English, no jargon, no em-dashes (presentation-layer rule). The desktop tour
// has its own steps in tourSteps.ts; this is the separate, lean mobile set.

// data-tour value for the mobile build button. Shared by the build step's
// target and the button's attribute so the two cannot drift.
export const MOBILE_BUILD_TOUR_TARGET = "mobile-build";

// localStorage key, separate from the desktop tour's, so the two tours are
// independent (a phone visitor still gets the richer desktop tour later).
export const MOBILE_TOUR_SEEN_KEY = "spacesim.tourSeenMobile";

export interface MobileTourStep {
  id: "welcome" | "inspect" | "gestures" | "build" | "done";
  // data-tour value of the element to spotlight; null = no spotlight (card only).
  target: string | null;
  // Card position when there is no anchored target. "center" floats it mid-
  // screen; "bottom" docks it above the collapsed control sheet.
  placement: "center" | "bottom";
  // Background when there is no target: a light scrim (scene stays visible) or
  // none (fully clear, for the gesture steps). Ignored when target is set, the
  // spotlight provides its own dim then.
  dim: "light" | "none";
  eyebrow: string;
  copy: string;
}

export const MOBILE_TOUR_STEPS: readonly MobileTourStep[] = [
  {
    id: "welcome",
    target: null,
    placement: "center",
    dim: "light",
    eyebrow: "Welcome",
    copy:
      "Everything you see is moving under real gravity, worked out live as it " +
      "goes. Here's the quick tour.",
  },
  {
    id: "inspect",
    target: null,
    placement: "bottom",
    dim: "none",
    eyebrow: "Tip",
    copy:
      "Tap any planet to lock onto it and see how fast it's moving and the " +
      "shape of its orbit.",
  },
  {
    id: "gestures",
    target: null,
    placement: "bottom",
    dim: "none",
    eyebrow: "Move around",
    copy: "Pinch to zoom in and out. Drag to swing the camera around.",
  },
  {
    id: "build",
    target: MOBILE_BUILD_TOUR_TARGET,
    placement: "center",
    dim: "none",
    eyebrow: "Build your own",
    copy:
      "Want to build your own? Tap here to pick planets and a start date, " +
      "then watch it run.",
  },
  {
    id: "done",
    target: null,
    placement: "center",
    dim: "light",
    eyebrow: "All set",
    copy: "That's it. Explore as long as you like.",
  },
];
