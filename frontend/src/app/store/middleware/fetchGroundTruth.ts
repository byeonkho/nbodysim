import { createAsyncThunk } from "@reduxjs/toolkit";
import { REST_URL } from "@/app/utils/backendUrls";
import { mergeAnchors } from "@/app/store/slices/GroundTruthSlice";
import type { components } from "@/app/generated/api";
import type { AppDispatch, RootState } from "@/app/store/Store";

type GroundTruthResponse = components["schemas"]["GroundTruthResponse"];

// One year per fetched window. Bounded memory; extended lazily as playback
// approaches the edge (see groundTruthMiddleware / shouldExtendWindow).
export const GROUND_TRUTH_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

interface FetchArgs {
  sessionID: string;
  fromMs: number;
  toMs: number;
}

export const fetchGroundTruth = createAsyncThunk<
  void,
  FetchArgs,
  { state: RootState; dispatch: AppDispatch }
>("groundTruth/fetch", async ({ sessionID, fromMs, toMs }, { dispatch }) => {
  const url = `${REST_URL}/ground-truth?sessionId=${encodeURIComponent(sessionID)}`
    + `&fromEpoch=${fromMs}&toEpoch=${toMs}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    // Side channel: a failure leaves the core sim untouched. Log, don't toast.
    console.warn(`ground-truth fetch failed: HTTP ${response.status}`);
    return;
  }
  const data: GroundTruthResponse = await response.json();
  dispatch(mergeAnchors({
    tracks: (data.tracks ?? []).map((t) => ({
      name: t.name ?? "",
      anchors: (t.anchors ?? []).map((a) => ({
        epochMillis: a.epochMillis ?? 0,
        position: a.position ?? [0, 0, 0],
        velocity: a.velocity ?? [0, 0, 0],
      })),
    })),
    fromMs,
    toMs,
  }));
});
