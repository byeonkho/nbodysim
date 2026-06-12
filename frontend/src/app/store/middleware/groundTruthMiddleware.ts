import type { Middleware } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store/Store";
import {
  appendChunkToBuffer,
  setActiveBody,
  setLastSimRequest,
  loadSimulation,
} from "@/app/store/slices/SimulationSlice";
import {
  resetGroundTruth,
  setOverlayEnabled,
  setTrueTrack,
  clearTrueTrack,
} from "@/app/store/slices/GroundTruthSlice";
import { fetchGroundTruth } from "@/app/store/middleware/fetchGroundTruth";
import { buildTrueTrack, computeTrueTrackRequest } from "@/app/store/trueTrack";
import { getDevSettings } from "@/app/dev/devSettingsStore";
import { FRAME_CODE } from "@/app/constants/SimParams";

// Keyframes of lookahead beyond the playback head when sizing the fetch window,
// so coverage stays ahead of playback between chunk arrivals.
const LOOKAHEAD_KEYFRAMES = 4000;
// Target anchor count per fetch (active body). The cadence is sized so the
// visible window yields ~this many anchors: bounded payload, fine enough for
// smooth interpolation in the watchable regime.
const TARGET_ANCHORS = 400;

// One fetch in flight at a time. Cleared when the thunk settles, so a failed or
// superseded fetch is retried on the next trigger. Module-level is safe: single store.
let fetchInFlight = false;

type Store = { getState: () => RootState; dispatch: AppDispatch };

// Rebuilds the Tier-2 buffer for the active body from its anchors + the current
// predicted buffer, when the overlay is on and the body has anchors. Else clears.
function rebuildTrueTrack(store: Store): void {
  const state = store.getState();
  const { overlayEnabled, anchorsByBody } = state.groundTruth;
  const activeBody = state.simulation.activeBodyState.activeBodyName;
  const predicted = state.simulation.chunkBuffer;

  if (!overlayEnabled || !activeBody || !predicted || predicted.totalTimesteps === 0) {
    if (state.groundTruth.trueTrack) store.dispatch(clearTrueTrack());
    return;
  }
  const anchors = anchorsByBody[activeBody.toUpperCase()];
  if (!anchors || anchors.length === 0) {
    if (state.groundTruth.trueTrack) store.dispatch(clearTrueTrack());
    return; // unsupported body (moon / minor body) — no truth in v1
  }
  const buffer = buildTrueTrack(anchors, predicted, activeBody.toUpperCase());
  store.dispatch(setTrueTrack({ buffer, body: activeBody.toUpperCase() }));
}

// Fetches the active body's true track for the current visible window, unless
// the overlay is off, no body is focused, a fetch is already in flight, or the
// window is already covered. Rebuilds Tier-2 when the fetch lands.
function maybeFetch(store: Store, immediate: boolean): void {
  const state = store.getState();
  const { overlayEnabled, coveredBody, coveredFromMs, coveredToMs } =
    state.groundTruth;
  const activeBody = state.simulation.activeBodyState.activeBodyName;
  const predicted = state.simulation.chunkBuffer;
  // Sessionless: ground truth needs only body + frame, so the overlay works
  // during preset-clip playback too. lastRequest (set by both the live path
  // and runStaticClip) carries the display frame label.
  const lastRequest = state.simulation.simulationParameters?.lastRequest;

  // Chunk-driven refetches respect the in-flight guard (storm prevention during
  // window slides). User-driven changes (focus / overlay) bypass it so the new
  // body's drift appears after a single fetch round-trip instead of waiting for
  // the next chunk — clicks are infrequent, so they carry no storm risk.
  if (!immediate && fetchInFlight) return;
  if (!overlayEnabled || !activeBody || !predicted || !lastRequest) return;

  const idx = state.simulation.timeState.currentTimeStepIndex;
  const trailLength = getDevSettings().trailLength;
  const req = computeTrueTrackRequest(
    predicted,
    idx,
    trailLength,
    LOOKAHEAD_KEYFRAMES,
    TARGET_ANCHORS,
  );
  if (!req) return;

  const activeUpper = activeBody.toUpperCase();
  const covered =
    coveredBody === activeUpper &&
    coveredFromMs !== null &&
    coveredToMs !== null &&
    coveredFromMs <= req.fromMs &&
    coveredToMs >= req.toMs;
  if (covered) return;

  fetchInFlight = true;
  const dispatched = store.dispatch(
    fetchGroundTruth({
      frame: FRAME_CODE[lastRequest.frame] ?? lastRequest.frame,
      body: activeUpper,
      ...req,
    }) as never,
  ) as unknown as Promise<unknown>;
  dispatched.finally(() => {
    fetchInFlight = false;
    rebuildTrueTrack(store); // pick up the freshly-fetched anchors
  });
}

export const groundTruthMiddleware: Middleware =
  (store) => (next) => (action) => {
    const result = next(action);
    const typedStore = store as unknown as Store;

    // New simulation: reset and clear any in-flight guard. No eager fetch — the
    // first fetch fires once a body is focused with the overlay on (below).
    if (setLastSimRequest.match(action)) {
      fetchInFlight = false;
      typedStore.dispatch(resetGroundTruth());
      return result;
    }

    // New chunk: rebuild Tier-2 against the new keyframes, then fetch if the
    // visible window has slid past current coverage.
    if (appendChunkToBuffer.match(action)) {
      rebuildTrueTrack(typedStore);
      maybeFetch(typedStore, /* immediate */ false);
      return result;
    }

    // Active body changed or overlay toggled: rebuild (or clear), then fetch.
    if (setActiveBody.match(action) || setOverlayEnabled.match(action)) {
      rebuildTrueTrack(typedStore);
      maybeFetch(typedStore, /* immediate */ true);
      return result;
    }

    // Fresh /initialize JSON (new session): clear stale Tier-2 immediately.
    if (loadSimulation.match(action)) {
      typedStore.dispatch(clearTrueTrack());
      return result;
    }

    return result;
  };
