import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// UI-relevant request state for chunk fetches.

interface RequestState {
  isRequestInProgress: boolean;
  errorMessage: string | null;
}

const initialState: RequestState = {
  isRequestInProgress: false,
  errorMessage: null,
};

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
    setRequestInProgress: (state, action: PayloadAction<boolean>) => {
      state.isRequestInProgress = action.payload;
    },
  },
});

export const { setErrorMessage, clearErrorMessage, setRequestInProgress } =
  requestSlice.actions;

export default requestSlice.reducer;
