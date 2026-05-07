import { configureStore } from "@reduxjs/toolkit";
import simulationSliceReducer, {
  simulationSetSnapshotMiddleware,
  simulationUpdateDataMiddleware,
} from "./slices/SimulationSlice";
import requestReducer from "./slices/RequestSlice";

export const store = configureStore({
  reducer: {
    simulation: simulationSliceReducer,
    request: requestReducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false, // disable SerializableStateInvariantMiddleware; high performance load due
      // to checking large state in slice every update in dev mode
    }).concat(simulationUpdateDataMiddleware, simulationSetSnapshotMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
