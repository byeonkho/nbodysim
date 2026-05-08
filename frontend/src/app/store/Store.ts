import { configureStore } from "@reduxjs/toolkit";
import simulationSliceReducer, {
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
      serializableCheck: false,
    }).concat(simulationUpdateDataMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
