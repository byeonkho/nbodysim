import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store/Store";
import type { ChunkBuffer } from "@/app/store/chunkBuffer";
import type { GroundTruthAnchorLike } from "@/app/store/trueTrack";

export interface GroundTruthState {
  // User toggle for the drift overlay. Persists across resubmits.
  overlayEnabled: boolean;
  // Tier 1: sparse true-position anchors per body, keyed by UPPER-CASE name.
  // Only the active body is populated (the overlay renders one body at a time);
  // a prior body's anchors may linger harmlessly until overwritten or reset.
  anchorsByBody: Record<string, GroundTruthAnchorLike[]>;
  // The body + window (millis UTC) most recently fetched. The middleware skips
  // a refetch while the visible window is already within [coveredFrom, coveredTo]
  // for the active body. null before the first fetch / after reset.
  coveredBody: string | null;
  coveredFromMs: number | null;
  coveredToMs: number | null;
  // Tier 2: dense, keyframe-aligned single-body buffer for the active body.
  // Held like simulation.chunkBuffer (typed-array-backed, reassigned on
  // rebuild). serializableCheck is disabled store-wide.
  trueTrack: ChunkBuffer | null;
  trueTrackBody: string | null;
  // True while a ground-truth fetch is in flight. UI-only signal (the Drift
  // chip's busy state and the slow-first-fetch notice); the middleware keeps
  // its own in-flight guard for dispatch gating.
  fetchInFlight: boolean;
}

const initialState: GroundTruthState = {
  overlayEnabled: false,
  anchorsByBody: {},
  coveredBody: null,
  coveredFromMs: null,
  coveredToMs: null,
  trueTrack: null,
  trueTrackBody: null,
  fetchInFlight: false,
};

export const groundTruthSlice = createSlice({
  name: "groundTruth",
  initialState,
  reducers: {
    setOverlayEnabled: (state, action: PayloadAction<boolean>) => {
      state.overlayEnabled = action.payload;
    },

    // Replaces a single body's anchors with a freshly-fetched window's worth,
    // and records the covered window. Replace (not merge): each fetch returns
    // the full set for the requested visible window, so a stale/overlapping
    // response can't accumulate duplicate or out-of-order anchors.
    setBodyAnchors: (
      state,
      action: PayloadAction<{
        body: string;
        anchors: GroundTruthAnchorLike[];
        fromMs: number;
        toMs: number;
      }>,
    ) => {
      const key = action.payload.body.toUpperCase();
      state.anchorsByBody[key] = action.payload.anchors;
      state.coveredBody = key;
      state.coveredFromMs = action.payload.fromMs;
      state.coveredToMs = action.payload.toMs;
    },

    setTrueTrack: (
      state,
      action: PayloadAction<{ buffer: ChunkBuffer; body: string }>,
    ) => {
      state.trueTrack = action.payload.buffer;
      state.trueTrackBody = action.payload.body;
    },

    clearTrueTrack: (state) => {
      state.trueTrack = null;
      state.trueTrackBody = null;
    },

    // Full reset on a new simulation. Preserves overlayEnabled (a user pref,
    // like showTrails survives a resubmit in SimulationSlice).
    resetGroundTruth: (state) => {
      state.anchorsByBody = {};
      state.coveredBody = null;
      state.coveredFromMs = null;
      state.coveredToMs = null;
      state.trueTrack = null;
      state.trueTrackBody = null;
      // A response for the old sim may never settle visibly; don't let a new
      // sim inherit a stuck busy indicator.
      state.fetchInFlight = false;
    },
  },
  // Follow the fetch thunk's lifecycle by action TYPE rather than importing
  // its action creators: the thunk module imports this slice, so importing it
  // back here would be a require cycle.
  extraReducers: (builder) => {
    builder
      .addCase("groundTruth/fetch/pending", (state) => {
        state.fetchInFlight = true;
      })
      .addCase("groundTruth/fetch/fulfilled", (state) => {
        state.fetchInFlight = false;
      })
      .addCase("groundTruth/fetch/rejected", (state) => {
        state.fetchInFlight = false;
      });
  },
});

export const {
  setOverlayEnabled,
  setBodyAnchors,
  setTrueTrack,
  clearTrueTrack,
  resetGroundTruth,
} = groundTruthSlice.actions;

export default groundTruthSlice.reducer;

// --- selectors ---
export const selectOverlayEnabled = (state: RootState): boolean =>
  state.groundTruth.overlayEnabled;
export const selectTrueTrack = (state: RootState): ChunkBuffer | null =>
  state.groundTruth.trueTrack;
export const selectTrueTrackBody = (state: RootState): string | null =>
  state.groundTruth.trueTrackBody;
export const selectAnchorsByBody = (
  state: RootState,
): Record<string, GroundTruthAnchorLike[]> => state.groundTruth.anchorsByBody;
export const selectGroundTruthFetchInFlight = (state: RootState): boolean =>
  state.groundTruth.fetchInFlight;
