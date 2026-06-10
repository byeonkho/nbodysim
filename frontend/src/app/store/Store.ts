import { configureStore } from "@reduxjs/toolkit";
import simulationSliceReducer, {
  simulationUpdateDataMiddleware,
} from "./slices/SimulationSlice";
import requestReducer from "./slices/RequestSlice";
import eventLogReducer from "./slices/EventLogSlice";
import groundTruthReducer from "./slices/GroundTruthSlice";
import uiReducer from "./slices/UISlice";
import tourReducer from "./slices/TourSlice";
import { groundTruthMiddleware } from "./middleware/groundTruthMiddleware";
import { userActionLogger } from "./middleware/userActionLogger";
import { tourMiddleware } from "./middleware/tourMiddleware";

export const store = configureStore({
  reducer: {
    simulation: simulationSliceReducer,
    request: requestReducer,
    eventLog: eventLogReducer,
    groundTruth: groundTruthReducer,
    ui: uiReducer,
    tour: tourReducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    })
      .concat(simulationUpdateDataMiddleware)
      .concat(groundTruthMiddleware)
      .concat(userActionLogger)
      .concat(tourMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
