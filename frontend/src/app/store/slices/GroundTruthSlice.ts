import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store/Store";
import type { ChunkBuffer } from "@/app/store/chunkBuffer";
import type { GroundTruthAnchorLike } from "@/app/store/trueTrack";

export interface GroundTruthTrack {
  name: string;
  anchors: GroundTruthAnchorLike[];
}

export interface GroundTruthState {
  // User toggle for the drift overlay. Persists across resubmits.
  overlayEnabled: boolean;
  // Tier 1: sparse true-position anchors per body, keyed by UPPER-CASE name.
  anchorsByBody: Record<string, GroundTruthAnchorLike[]>;
  // Bounds of the fetched window (millis UTC), or null before the first fetch.
  fetchedFromMs: number | null;
  fetchedToMs: number | null;
  // Tier 2: dense, keyframe-aligned single-body buffer for the active body.
  // Held like simulation.chunkBuffer (typed-array-backed, reassigned on
  // rebuild). serializableCheck is disabled store-wide.
  trueTrack: ChunkBuffer | null;
  trueTrackBody: string | null;
}

const initialState: GroundTruthState = {
  overlayEnabled: false,
  anchorsByBody: {},
  fetchedFromMs: null,
  fetchedToMs: null,
  trueTrack: null,
  trueTrackBody: null,
};

export const groundTruthSlice = createSlice({
  name: "groundTruth",
  initialState,
  reducers: {
    setOverlayEnabled: (state, action: PayloadAction<boolean>) => {
      state.overlayEnabled = action.payload;
    },

    // Appends a freshly-fetched window's anchors to each body's track,
    // dropping a leading anchor that duplicates the prior window's final
    // anchor (the two windows share their boundary epoch). Updates the
    // fetched-window bounds.
    mergeAnchors: (
      state,
      action: PayloadAction<{ tracks: GroundTruthTrack[]; fromMs: number; toMs: number }>,
    ) => {
      for (const track of action.payload.tracks) {
        const key = track.name.toUpperCase();
        const existing = state.anchorsByBody[key];
        if (!existing || existing.length === 0) {
          state.anchorsByBody[key] = track.anchors;
          continue;
        }
        const lastEpoch = existing[existing.length - 1].epochMillis;
        // Drop every incoming anchor at or before the last stored epoch. The
        // normal case drops just the shared boundary anchor; this also makes the
        // merge idempotent if an overlapping window is fetched (e.g. two
        // extension fetches race), preventing duplicate, out-of-order anchors
        // that would break buildTrueTrack's monotonic cursor.
        const incoming = track.anchors.filter((a) => a.epochMillis > lastEpoch);
        state.anchorsByBody[key] = existing.concat(incoming);
      }
      state.fetchedFromMs = state.fetchedFromMs ?? action.payload.fromMs;
      state.fetchedToMs = action.payload.toMs;
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
      state.fetchedFromMs = null;
      state.fetchedToMs = null;
      state.trueTrack = null;
      state.trueTrackBody = null;
    },
  },
});

export const {
  setOverlayEnabled,
  mergeAnchors,
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
export const selectAnchorsByBody = (state: RootState): Record<string, GroundTruthAnchorLike[]> =>
  state.groundTruth.anchorsByBody;
