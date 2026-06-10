import type { Middleware } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store/Store";
import {
  loadSimulation,
  appendChunkToBuffer,
} from "@/app/store/slices/SimulationSlice";
import { enterAwaitingRun, resumePhase2 } from "@/app/store/slices/TourSlice";

// Bridges the tour state machine to the simulation lifecycle so TourSlice
// never imports the chunk pipeline.
//  - loadSimulation (a run has started loading) → if the tour is in phase1,
//    enter awaitingRun so the overlay stays hidden through the load gap.
//  - appendChunkToBuffer that flips hasReceivedFirstChunk false→true → if
//    awaitingRun, resume into phase2 over the now-live scene.
export const tourMiddleware: Middleware = (store) => (next) => (action) => {
  const type = (action as { type: string }).type;

  if (type === loadSimulation.type) {
    if ((store.getState() as RootState).tour.status === "phase1") {
      store.dispatch(enterAwaitingRun());
    }
    return next(action);
  }

  if (type === appendChunkToBuffer.type) {
    const before = (store.getState() as RootState).simulation
      .hasReceivedFirstChunk;
    const result = next(action);
    const state = store.getState() as RootState;
    if (
      !before &&
      state.simulation.hasReceivedFirstChunk &&
      state.tour.status === "awaitingRun"
    ) {
      store.dispatch(resumePhase2());
    }
    return result;
  }

  return next(action);
};
