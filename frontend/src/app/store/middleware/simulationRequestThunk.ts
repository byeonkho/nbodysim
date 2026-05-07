// Thunk that fetches the next simulation chunk over HTTP, decodes it off-thread
// via the zstd worker, and dispatches the parsed payload into Redux.

import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  selectCurrentTimeStepIndex,
  setCurrentTimeStepIndex,
  setIsUpdating,
  updateDataReceived,
} from "@/app/store/slices/SimulationSlice";
import {
  setErrorMessage,
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { RootState } from "@/app/store/Store";
import type { DecodeResponse } from "./zstdWorker";

// Decoder Worker — module singleton, kept alive for the page session.
let decoderWorker: Worker | null = null;
let decodeIdCounter = 0;
const pendingDecodes = new Map<
  number,
  { resolve: (value: any) => void; reject: (reason: Error) => void }
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
      pending.resolve(event.data.payload);
    }
  };
  decoderWorker.onerror = (event: ErrorEvent) => {
    console.error("zstd worker error:", event.message);
  };
  return decoderWorker;
}

function decodeOffMainThread(buffer: ArrayBuffer): Promise<any> {
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
  async ({ sessionID }, { dispatch, getState }) => {
    dispatch(setIsUpdating(true));
    dispatch(setRequestInProgress(true));

    try {
      const response = await fetch(`${REST_URL}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionID }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const messageData = await decodeOffMainThread(buffer);

      dispatch(setRequestInProgress(false));
      dispatch(updateDataReceived({ data: messageData.data }));

      // First-chunk init: kick the index so the snapshot middleware fires.
      const updatedState = getState();
      if (selectCurrentTimeStepIndex(updatedState) === 0) {
        dispatch(setCurrentTimeStepIndex(0));
      }
    } catch (err) {
      dispatch(setRequestInProgress(false));
      dispatch(setIsUpdating(false));
      const message = err instanceof Error ? err.message : "Unknown error";
      dispatch(setErrorMessage(`Failed to load simulation chunk: ${message}`));
      throw err;
    }
  },
);
