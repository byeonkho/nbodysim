// Thunk that fetches the next simulation chunk over HTTP, decodes it off-thread
// via the zstd worker, and dispatches the parsed payload into Redux.

import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  appendChunkToBuffer,
  expireSession,
} from "@/app/store/slices/SimulationSlice";
import {
  recordFetchLatency,
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { AppDispatch, RootState } from "@/app/store/Store";
import type { DecodeResponse } from "./zstdWorker";
import { computeBackoffMs, MAX_CHUNK_RETRY_ATTEMPTS } from "./chunkBackoff";

interface ChunkPayload {
  messageType: string;
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: Float64Array;
  mu: Record<string, number>;
  deltaERelative: Float32Array;
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
}

// Decoder Worker — module singleton, kept alive for the page session.
let decoderWorker: Worker | null = null;
let decodeIdCounter = 0;
const pendingDecodes = new Map<
  number,
  { resolve: (value: ChunkPayload) => void; reject: (reason: Error) => void }
>();

function getDecoderWorker(): Worker {
  if (decoderWorker) return decoderWorker;
  decoderWorker = new Worker(new URL("./zstdWorker.ts", import.meta.url), {
    type: "module",
  });
  decoderWorker.onmessage = (event: MessageEvent<DecodeResponse>) => {
    const { id } = event.data;
    const pending = pendingDecodes.get(id);
    if (!pending) return;
    pendingDecodes.delete(id);
    if ("error" in event.data) {
      pending.reject(new Error(event.data.error));
    } else {
      pending.resolve(event.data.payload as ChunkPayload);
    }
  };
  decoderWorker.onerror = (event: ErrorEvent) => {
    console.error("zstd worker error:", event.message);
    // A worker-level failure (the module or its WASM failed to load/run) means
    // any in-flight decode will never get a response. Reject them so the chunk
    // request surfaces an error (via the thunk's catch) instead of hanging
    // forever.
    const failure = new Error(
      `Decoder worker failed: ${event.message || "unknown error"}`,
    );
    pendingDecodes.forEach((pending) => pending.reject(failure));
    pendingDecodes.clear();
    // Drop the worker so the next decode spins up a fresh one: self-heals a
    // transient failure; a permanent one just re-surfaces the error.
    decoderWorker = null;
  };
  return decoderWorker;
}

// Exported so the static-clip path can decode bundled chunks through the same
// worker the live chunk path uses (one zstd worker for the page session).
export function decodeOffMainThread(buffer: ArrayBuffer): Promise<ChunkPayload> {
  const id = ++decodeIdCounter;
  return new Promise((resolve, reject) => {
    pendingDecodes.set(id, { resolve, reject });
    getDecoderWorker().postMessage({ id, buffer }, [buffer]);
  });
}

interface RequestRunSimulationArgs {
  sessionID: string;
}

export const requestRunSimulation = createAsyncThunk<
  void,
  RequestRunSimulationArgs,
  { state: RootState }
>(
  "simulation/requestChunk",
  async ({ sessionID }, { dispatch, getState, signal }) => {
    dispatch(setRequestInProgress(true));
    const tStart = performance.now();
    // The retry coordinator re-enters through dispatchChunkRequest, which is
    // typed to the app store's dispatch. The thunk's own dispatch is that same
    // store dispatch (only the thunk-extra-arg generic differs), so narrow it
    // once here for the retry helpers rather than typing the whole thunk to a
    // concrete AppDispatch (which would reject the minimal store used in tests).
    const appDispatch = dispatch as AppDispatch;

    try {
      // The index of the chunk we want next = how many we've appended. On a
      // retried fetch (the prior one failed before appending) this is unchanged,
      // so the server re-serves that chunk instead of advancing the cursor.
      const expectedChunkIndex = getState().simulation.chunksAppended;
      const response = await fetch(`${REST_URL}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID, expectedChunkIndex }),
        signal,
      });

      // Terminal: the session is gone (410, idle-evicted or released on
      // resubmit) or the cursors are out of step (409). Retrying recovers
      // neither; clear the session so the prefetch loop stops and prompt a
      // fresh run.
      if (response.status === 410 || response.status === 409) {
        // Stale guard: a retry for an OLD session can land here after the user
        // started a new one (the backend releases the prior session). Only
        // expire if this response is still for the current session.
        const current =
          getState().simulation.simulationParameters?.simulationMetaData
            ?.sessionID;
        if (current !== sessionID) {
          dispatch(setRequestInProgress(false));
          return;
        }
        resetChunkRetry();
        dispatch(setRequestInProgress(false));
        dispatch(expireSession());
        dispatch(
          setErrorMessage(
            response.status === 410
              ? "This simulation timed out. Press Run to start it again."
              : "The simulation got out of sync. Press Run to start it again.",
          ),
        );
        return;
      }

      // Rate limited: back off (honoring Retry-After when present).
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const delayMs =
          seconds && !Number.isNaN(seconds) ? seconds * 1000 : undefined;
        scheduleRetryOrGiveUp(
          appDispatch,
          sessionID,
          "The simulator is busy. Trying again in a moment.",
          delayMs,
        );
        return;
      }

      if (!response.ok) {
        // 5xx: transient, back off. Other 4xx (e.g. 400): terminal error.
        if (response.status >= 500) {
          scheduleRetryOrGiveUp(
            appDispatch,
            sessionID,
            "Reconnecting to the simulator.",
          );
          return;
        }
        resetChunkRetry();
        dispatch(setRequestInProgress(false));
        dispatch(
          setErrorMessage(
            "Could not load more of the simulation. Press Run to try again.",
          ),
        );
        return;
      }

      const buffer = await response.arrayBuffer();
      const messageData = await decodeOffMainThread(buffer);

      // Superseded while decoding: the abort rejects an in-flight fetch but
      // can't interrupt the decode await, so check the signal directly. The
      // newer request owns the in-progress flag and the buffer now; falling
      // through would append this request's timesteps late.
      if (signal.aborted) {
        return;
      }

      // Stale-session guard: if the user resubmitted while this chunk was
      // in flight (or being decoded), the slice's current sessionID has
      // already moved on. Drop silently — merging would splatter old
      // timesteps into the new buffer. See todo #55.
      const currentSessionID =
        getState().simulation.simulationParameters?.simulationMetaData?.sessionID;
      if (currentSessionID !== sessionID) {
        dispatch(setRequestInProgress(false));
        return;
      }

      // A good chunk ends any failure streak.
      resetChunkRetry();

      const elapsedMs = performance.now() - tStart;
      dispatch(recordFetchLatency(elapsedMs));
      dispatch(setRequestInProgress(false));
      dispatch(
        appendChunkToBuffer({
          bodyNames: messageData.bodyNames,
          bodyCount: messageData.bodyCount,
          timestepCount: messageData.timestepCount,
          positions: messageData.positions,
          timestamps: messageData.timestamps,
          mu: messageData.mu,
          deltaERelative: messageData.deltaERelative,
          dp853AvgStepSeconds: messageData.dp853AvgStepSeconds,
          dp853AcceptRate: messageData.dp853AcceptRate,
        }),
      );
    } catch (err) {
      // Aborted by dispatchChunkRequest when a newer request supersedes
      // this one — silent, not a user-facing error. The superseder set
      // isRequestInProgress(true) synchronously at dispatch, before this
      // catch runs (the abort rejection lands a microtask later), and owns
      // the flag from here: resetting it would knock it back to false
      // mid-flight and re-open the prefetch gate to duplicate requests.
      if (signal.aborted) {
        return;
      }
      // An AbortError without our signal aborted has no superseder owning
      // the flag (e.g. the browser tearing down fetches on navigation):
      // reset the flag, stay silent, no retry.
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "CanceledError")
      ) {
        dispatch(setRequestInProgress(false));
        return;
      }
      // Network error or decode failure: transient. Back off (leaving
      // isRequestInProgress true so the prefetch middleware does not also
      // re-fire) instead of surfacing a terminal error.
      scheduleRetryOrGiveUp(
        appDispatch,
        sessionID,
        "Lost the connection to the simulator. Trying again.",
      );
    }
  },
);

// Module-level handle on the most recent in-flight chunk dispatch. Used
// by dispatchChunkRequest to abort a superseded request (e.g. user
// resubmits while a chunk is still in flight). createAsyncThunk's
// dispatch return-value carries .abort() which signals AbortSignal on
// the thunk — the fetch above wires `signal` so the network round-trip
// terminates immediately.
let currentChunkDispatch:
  | (Promise<unknown> & { abort: (reason?: string) => void })
  | null = null;

export function dispatchChunkRequest(
  dispatch: AppDispatch,
  args: RequestRunSimulationArgs,
) {
  if (currentChunkDispatch) {
    currentChunkDispatch.abort("superseded");
  }
  currentChunkDispatch = dispatch(requestRunSimulation(args));
  return currentChunkDispatch;
}

// ── Backoff retry coordinator ──────────────────────────────────────────────
// A single pending retry timer + attempt counter for the chunk fetch, at module
// scope (like currentChunkDispatch): imperative timing state, not render state.
// The timer drives retries independent of playback-index dispatches, so it
// recovers a stall at the buffer end; keeping isRequestInProgress true during
// the wait suppresses the prefetch middleware's per-frame re-fire (no hammer).
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function scheduleChunkRetry(
  dispatch: AppDispatch,
  sessionID: string,
  delayMs?: number,
) {
  if (retryTimer !== null) return; // a retry is already armed
  const delay = delayMs ?? computeBackoffMs(retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    dispatchChunkRequest(dispatch, { sessionID });
  }, delay);
}

// Cancel any pending retry and zero the counter. Called on a successful fetch
// and at launch so a fresh run starts clean.
export function resetChunkRetry() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

// Test accessor for the current attempt count.
export function chunkRetryAttempts(): number {
  return retryAttempt;
}

// Arm the next backoff retry, or give up once the attempt budget is spent.
// The transient path leaves isRequestInProgress true; give-up resets it.
function scheduleRetryOrGiveUp(
  dispatch: AppDispatch,
  sessionID: string,
  retryingMessage: string,
  delayMs?: number,
) {
  if (retryAttempt >= MAX_CHUNK_RETRY_ATTEMPTS) {
    resetChunkRetry();
    dispatch(setRequestInProgress(false));
    dispatch(
      setErrorMessage("Could not reach the simulator. Press Run to try again."),
    );
    return;
  }
  dispatch(setErrorMessage(retryingMessage));
  scheduleChunkRetry(dispatch, sessionID, delayMs);
}
