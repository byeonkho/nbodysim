import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface WebSocketState {
  socket: WebSocket | null;
  isConnected: boolean;
  isRequestInProgress: boolean;
  errorMessage: string | null;
}

const initialState: WebSocketState = {
  socket: null,
  isConnected: false,
  isRequestInProgress: false,
  errorMessage: null,
};

export const webSocketSlice = createSlice({
  name: "webSocket",
  initialState,
  reducers: {
    connected: (state) => {
      state.isConnected = true;
      state.errorMessage = null;
    },
    disconnected: (state) => {
      state.isConnected = false;
      state.errorMessage = null;
    },
    setErrorMessage: (state, action: PayloadAction<string>) => {
      state.errorMessage = action.payload;
    },
    clearErrorMessage: (state) => {
      state.errorMessage = null;
    },
    setRequestInProgress: (state, action: PayloadAction<boolean>) => {
      state.isRequestInProgress = action.payload;
    },

    notificationReceived: (state, action: PayloadAction<any>) => {
      // Handle notification logic
    },
  },
});

export const {
  connected,
  disconnected,
  setErrorMessage,
  clearErrorMessage,
  setRequestInProgress,
} = webSocketSlice.actions;

export default webSocketSlice.reducer;