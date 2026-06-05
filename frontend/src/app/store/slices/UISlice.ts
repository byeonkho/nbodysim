import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store/Store";

// Collapse state for the right-column chrome panels (info card + event log).
// Lives in Redux (not local component state) so it survives body switches and
// the info card's mount/unmount on deselect, and stays reachable by future
// wiring (e.g. the timeline's "Info" chip). Resets on reload — no persistence.

interface UIState {
  infoPanelCollapsed: boolean;
  eventLogCollapsed: boolean;
}

const initialState: UIState = {
  infoPanelCollapsed: false, // info expanded by default
  eventLogCollapsed: true, // event log collapsed by default
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleInfoPanel: (state) => {
      state.infoPanelCollapsed = !state.infoPanelCollapsed;
    },
    toggleEventLog: (state) => {
      state.eventLogCollapsed = !state.eventLogCollapsed;
    },
  },
});

export const { toggleInfoPanel, toggleEventLog } = uiSlice.actions;

export const selectInfoPanelCollapsed = (state: RootState) =>
  state.ui.infoPanelCollapsed;
export const selectEventLogCollapsed = (state: RootState) =>
  state.ui.eventLogCollapsed;

export default uiSlice.reducer;
