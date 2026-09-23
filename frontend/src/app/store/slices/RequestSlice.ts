import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { RootState } from "@/app/store/Store";

// UI-relevant request state for chunk fetches.

interface RequestState {
  isRequestInProgress: boolean;
  isLaunchInProgress: boolean;
  errorMessage: string | null;
  // Rolling EMA of recent chunk fetch wall-times (ms). Default 1000ms before
  // any measurement lands so the speed-aware threshold has a reasonable
  // starting estimate. Updated by the request thunk on each successful fetch.
  fetchLatencyEmaMs: number;
}

const initialState: RequestState = {
  isRequestInProgress: false,
  isLaunchInProgress: false,
  errorMessage: null,
  fetchLatencyEmaMs: 1000,
};

const EMA_ALPHA = 0.3;

export const requestSlice = createSlice({
  name: "request",
  initialState,
  reducers: {
    setErrorMessage: (state, action: PayloadAction<string>) => {
      state.errorMessage = action.payload;
    },
    clearErrorMessage: (state) => {
      state.errorMessage = null;
    },
    setLaunchInProgress: (state, action: PayloadAction<boolean>) => {
      state.isLaunchInProgress = action.payload;
    },
    setRequestInProgress: (state, action: PayloadAction<boolean>) => {
      state.isRequestInProgress = action.payload;
    },
    recordFetchLatency: (state, action: PayloadAction<number>) => {
      state.fetchLatencyEmaMs =
        (1 - EMA_ALPHA) * state.fetchLatencyEmaMs + EMA_ALPHA * action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase("simulation/loadSimulation", (state) => {
      state.isRequestInProgress = false;
      state.errorMessage = null;
    });
  },
});

export const selectFetchLatencyEmaMs = (state: RootState): number =>
  state.request.fetchLatencyEmaMs;

export const {
  setErrorMessage,
  clearErrorMessage,
  setRequestInProgress,
  setLaunchInProgress,
  recordFetchLatency,
} = requestSlice.actions;

export default requestSlice.reducer;
