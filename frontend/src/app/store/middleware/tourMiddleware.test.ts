import { describe, it, expect, beforeEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  loadSimulation,
} from "@/app/store/slices/SimulationSlice";
import tourReducer, { startTour } from "@/app/store/slices/TourSlice";
import { tourMiddleware } from "./tourMiddleware";

// Minimal store: only the slices the middleware touches. We exercise the
// phase1 → awaitingRun transition on loadSimulation; the first-chunk →
// phase2 hop is covered end-to-end in the browser smoke test (it needs a
// real chunk payload).
function makeStore() {
  return configureStore({
    reducer: { simulation: simulationReducer, tour: tourReducer },
    middleware: (g) => g({ serializableCheck: false }).concat(tourMiddleware),
  });
}

describe("tourMiddleware", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("moves an active phase1 tour to awaitingRun when a run starts", () => {
    store.dispatch(startTour(undefined));
    expect(store.getState().tour.status).toBe("phase1");
    store.dispatch(loadSimulation({} as never));
    expect(store.getState().tour.status).toBe("awaitingRun");
  });

  it("ignores loadSimulation when the tour is idle", () => {
    store.dispatch(loadSimulation({} as never));
    expect(store.getState().tour.status).toBe("idle");
  });
});
