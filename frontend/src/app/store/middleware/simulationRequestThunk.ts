// Thunk that fetches the next simulation chunk over HTTP, decodes it off-thread
// via the zstd worker, and dispatches the parsed payload into Redux.

import { createAsyncThunk } from "@reduxjs/toolkit";
import { appendChunkToBuffer } from "@/app/store/slices/SimulationSlice";
import {
  recordFetchLatency,
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { AppDispatch, RootState } from "@/app/store/Store";
import type { DecodeResponse } from "./zstdWorker";

interface ChunkPayload {
  messageType: string;
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: BigInt64Array;
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

    try {
      const response = await fetch(`${REST_URL}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID }),
        signal,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const wait = seconds && !Number.isNaN(seconds) ? ` Try again in ${seconds}s.` : "";
        throw new Error(`Rate limit reached.${wait}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
      dispatch(setRequestInProgress(false));
      // An AbortError without our signal aborted has no superseder owning
      // the flag (e.g. the browser tearing down fetches on navigation):
      // reset the flag above, but stay silent all the same.
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "CanceledError")
      ) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      dispatch(setErrorMessage(`Failed to load simulation chunk: ${message}`));
      throw err;
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
