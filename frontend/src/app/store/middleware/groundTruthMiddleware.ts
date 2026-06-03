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
import {
  fetchGroundTruth,
  GROUND_TRUTH_WINDOW_MS,
} from "@/app/store/middleware/fetchGroundTruth";
import { buildTrueTrack, shouldExtendWindow } from "@/app/store/trueTrack";

// Guards against dispatching a second window-extension fetch while one is
// already in flight. `fetchedToMs` only advances once the extension's
// mergeAnchors lands, so without this guard every chunk arriving during the
// network round-trip would fire another identical fetch. Cleared when the
// thunk settles (success or failure), so a failed extension auto-retries on
// the next chunk. Module-level is safe: there is a single store.
let extensionFetchInFlight = false;

// Rebuilds the Tier-2 buffer for the active body from Tier-1 anchors + the
// current predicted buffer, when the overlay is on and the active body is
// supported (has anchors). Otherwise clears it.
function rebuildTrueTrack(store: { getState: () => RootState; dispatch: AppDispatch }): void {
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

export const groundTruthMiddleware: Middleware =
  (store) => (next) => (action) => {
    const result = next(action);
    const typedStore = store as unknown as {
      getState: () => RootState;
      dispatch: AppDispatch;
    };

    // New simulation submitted: reset, then eager-fetch the first window.
    if (setLastSimRequest.match(action)) {
      // setLastSimRequest fires after initializeCelestialBodies() has resolved,
      // so simulationMetaData.sessionID is already populated in state here.
      const state = typedStore.getState();
      const sessionID =
        state.simulation.simulationParameters?.simulationMetaData?.sessionID;
      const dateIso = action.payload?.date;
      if (sessionID && dateIso) {
        extensionFetchInFlight = false;
        typedStore.dispatch(resetGroundTruth());
        const fromMs = Date.parse(dateIso);
        typedStore.dispatch(
          fetchGroundTruth({ sessionID, fromMs, toMs: fromMs + GROUND_TRUTH_WINDOW_MS }) as never,
        );
      }
      return result;
    }

    // A new chunk landed: rebuild Tier-2 (keyframes changed / evicted), and
    // extend the window if playback is nearing the fetched edge.
    if (appendChunkToBuffer.match(action)) {
      rebuildTrueTrack(typedStore);

      const state = typedStore.getState();
      const buffer = state.simulation.chunkBuffer;
      const { fetchedFromMs, fetchedToMs } = state.groundTruth;
      const sessionID =
        state.simulation.simulationParameters?.simulationMetaData?.sessionID;
      if (buffer && buffer.totalTimesteps > 0 && sessionID) {
        const latest = Number(buffer.timestamps[buffer.totalTimesteps - 1]);
        if (
          !extensionFetchInFlight &&
          fetchedToMs !== null &&
          shouldExtendWindow(latest, fetchedFromMs, fetchedToMs)
        ) {
          extensionFetchInFlight = true;
          const dispatched = typedStore.dispatch(
            fetchGroundTruth({
              sessionID,
              fromMs: fetchedToMs,
              toMs: fetchedToMs + GROUND_TRUTH_WINDOW_MS,
            }) as never,
          ) as unknown as Promise<unknown>;
          dispatched.finally(() => {
            extensionFetchInFlight = false;
          });
        }
      }
      return result;
    }

    // Active body changed or overlay toggled: rebuild (or clear) Tier-2.
    if (setActiveBody.match(action) || setOverlayEnabled.match(action)) {
      rebuildTrueTrack(typedStore);
      return result;
    }

    // Fresh /initialize JSON (new session): clear stale Tier-2 immediately so
    // the old body's true track doesn't linger before the eager fetch lands.
    if (loadSimulation.match(action)) {
      typedStore.dispatch(clearTrueTrack());
      return result;
    }

    return result;
  };
