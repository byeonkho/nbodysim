import { configureStore } from "@reduxjs/toolkit";
import simulationSliceReducer, {
  simulationUpdateDataMiddleware,
} from "./slices/SimulationSlice";
import requestReducer from "./slices/RequestSlice";
import eventLogReducer from "./slices/EventLogSlice";
import groundTruthReducer from "./slices/GroundTruthSlice";
import { userActionLogger } from "./middleware/userActionLogger";

export const store = configureStore({
  reducer: {
    simulation: simulationSliceReducer,
    request: requestReducer,
    eventLog: eventLogReducer,
    groundTruth: groundTruthReducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    })
      .concat(simulationUpdateDataMiddleware)
      .concat(userActionLogger),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
