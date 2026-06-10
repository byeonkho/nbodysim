import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store/Store";
import { PHASE1_STEPS, PHASE2_STEPS } from "@/app/constants/tourSteps";

const TOUR_SEEN_STORAGE_KEY = "spacesim.tourSeen";

export function readTourSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TOUR_SEEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_SEEN_STORAGE_KEY, "1");
  } catch {
    // private mode / storage disabled — non-fatal
  }
}

export type TourStatus = "idle" | "phase1" | "awaitingRun" | "phase2" | "done";

export interface TourState {
  status: TourStatus;
  stepIndex: number;
}

const initialState: TourState = { status: "idle", stepIndex: 0 };

export const tourSlice = createSlice({
  name: "tour",
  initialState,
  reducers: {
    startTour: (
      state,
      action: PayloadAction<{ atPhase2?: boolean } | undefined>,
    ) => {
      state.status = action.payload?.atPhase2 ? "phase2" : "phase1";
      state.stepIndex = 0;
    },
    nextStep: (state) => {
      const len =
        state.status === "phase1" ? PHASE1_STEPS.length : PHASE2_STEPS.length;
      state.stepIndex = Math.min(state.stepIndex + 1, len - 1);
    },
    prevStep: (state) => {
      state.stepIndex = Math.max(state.stepIndex - 1, 0);
    },
    enterAwaitingRun: (state) => {
      state.status = "awaitingRun";
    },
    resumePhase2: (state) => {
      state.status = "phase2";
      state.stepIndex = 0;
    },
    skipTour: (state) => {
      state.status = "done";
      writeTourSeen();
    },
    finishTour: (state) => {
      state.status = "done";
      writeTourSeen();
    },
  },
});

export const {
  startTour,
  nextStep,
  prevStep,
  enterAwaitingRun,
  resumePhase2,
  skipTour,
  finishTour,
} = tourSlice.actions;

export const selectTourStatus = (s: RootState) => s.tour.status;
export const selectTourStepIndex = (s: RootState) => s.tour.stepIndex;

export default tourSlice.reducer;
