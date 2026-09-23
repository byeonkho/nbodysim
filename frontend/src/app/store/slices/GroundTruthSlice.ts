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
  // The fetched window (millis UTC) per body, keyed by UPPER-CASE name. The
  // middleware skips a refetch while the active body's visible window is already
  // within its [fromMs, toMs]. Per body (not a single record) so flipping to
  // another body and back does not re-pull a body still in coverage. Empty
  // before the first fetch / after reset.
  coveredByBody: Record<string, { fromMs: number; toMs: number }>;
  // Tier 2: dense, keyframe-aligned single-body buffer for the active body.
  // Held like simulation.chunkBuffer (typed-array-backed, reassigned on
  // rebuild). serializableCheck is disabled store-wide.
  trueTrack: ChunkBuffer | null;
  trueTrackBody: string | null;
  // True while ANY ground-truth fetch is in flight. UI-only signal (the Drift
  // chip's busy pulse); the middleware keeps its own in-flight guard for
  // dispatch gating.
  fetchInFlight: boolean;
  pendingRequests: Record<string, boolean>;
  // True only while a USER-INITIATED fetch is in flight (toggling Drift,
  // switching the focused body). Drives the loading notice, which must stay
  // silent for the automatic background top-up refetches that slide coverage
  // forward during playback (those would otherwise blink the notice on a steady
  // interval). See the middleware's immediate flag.
  userFetchInFlight: boolean;
}

const initialState: GroundTruthState = {
  overlayEnabled: false,
  anchorsByBody: {},
  coveredByBody: {},
  trueTrack: null,
  trueTrackBody: null,
  fetchInFlight: false,
  pendingRequests: {},
  userFetchInFlight: false,
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
      state.coveredByBody[key] = {
        fromMs: action.payload.fromMs,
        toMs: action.payload.toMs,
      };
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
      state.coveredByBody = {};
      state.trueTrack = null;
      state.trueTrackBody = null;
      // A response for the old sim may never settle visibly; don't let a new
      // sim inherit a stuck busy indicator or loading notice.
      state.fetchInFlight = false;
      state.pendingRequests = {};
      state.userFetchInFlight = false;
    },
  },
  // Follow the fetch thunk's lifecycle by action TYPE rather than importing
  // its action creators: the thunk module imports this slice, so importing it
  // back here would be a require cycle.
  extraReducers: (builder) => {
    // Read the thunk's immediate flag off action.meta.arg (a user-initiated
    // fetch sets it true). Cast rather than import the thunk's types: matching
    // by action TYPE is what keeps the slice from importing the thunk module,
    // which imports this slice back.
    const isImmediate = (action: unknown): boolean =>
      (action as { meta?: { arg?: { immediate?: boolean } } }).meta?.arg
        ?.immediate === true;

    const requestKey = (action: unknown): string =>
      (action as { meta?: { requestId?: string } }).meta?.requestId ??
      (isImmediate(action) ? "legacy-user" : "legacy-background");
    const settle = (state: GroundTruthState, action: unknown) => {
      delete state.pendingRequests[requestKey(action)];
      state.fetchInFlight = Object.keys(state.pendingRequests).length > 0;
      state.userFetchInFlight = Object.values(state.pendingRequests).some(
        Boolean,
      );
    };
    builder
      .addCase("groundTruth/fetch/pending", (state, action) => {
        state.pendingRequests[requestKey(action)] = isImmediate(action);
        state.fetchInFlight = true;
        if (isImmediate(action)) state.userFetchInFlight = true;
      })
      .addCase("groundTruth/fetch/fulfilled", settle)
      .addCase("groundTruth/fetch/rejected", settle);
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
export const selectUserGroundTruthFetchInFlight = (state: RootState): boolean =>
  state.groundTruth.userFetchInFlight;
