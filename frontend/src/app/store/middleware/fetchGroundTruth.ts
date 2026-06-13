import { createAsyncThunk } from "@reduxjs/toolkit";
import { REST_URL } from "@/app/utils/backendUrls";
import { setBodyAnchors } from "@/app/store/slices/GroundTruthSlice";
import { currentLaunchEpoch, isCurrentLaunch } from "@/app/store/launchEpoch";
import type { components } from "@/app/generated/api";
import type { AppDispatch, RootState } from "@/app/store/Store";

type GroundTruthResponse = components["schemas"]["GroundTruthResponse"];

interface FetchArgs {
  frame: string; // backend frame CODE (e.g. "heliocentric"), not the display label
  body: string; // single focused body (active-only fetching)
  fromMs: number;
  toMs: number;
  stepSeconds: number; // cadence sized to the visible window by the caller
}

// Fetches the active body's true track for a visible window and REPLACES that
// body's anchors. Active-body-only keeps the recurring fetch small; replace
// (not merge) means a stale or overlapping response can't corrupt the anchor
// ordering. A failure is a no-op on the core sim (side channel).
export const fetchGroundTruth = createAsyncThunk<
  void,
  FetchArgs,
  { state: RootState; dispatch: AppDispatch }
>("groundTruth/fetch", async ({ frame, body, fromMs, toMs, stepSeconds }, { dispatch }) => {
  // Bind this fetch to the launch that started it. A resubmit bumps the
  // launch epoch (and resets the anchors); if that happened while this was
  // in flight, dropping it keeps the stale window from repopulating.
  const myEpoch = currentLaunchEpoch();

  const url =
    `${REST_URL}/ground-truth?body=${encodeURIComponent(body)}` +
    `&frame=${encodeURIComponent(frame)}` +
    `&fromEpoch=${fromMs}&toEpoch=${toMs}&stepSeconds=${stepSeconds}`;

  let data: GroundTruthResponse;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      console.warn(`ground-truth fetch failed: HTTP ${response.status}`);
      return;
    }
    data = await response.json();
  } catch (err) {
    // Network-level failure (offline, reset). The simulation carries on.
    console.warn("ground-truth fetch failed:", err);
    return;
  }

  const track = (data.tracks ?? []).find(
    (t) => (t.name ?? "").toUpperCase() === body.toUpperCase(),
  );
  // Empty anchors when the body is unsupported (moon / minor body): we still
  // record the covered window so the middleware doesn't refetch on every chunk.
  const anchors = (track?.anchors ?? []).map((a) => ({
    epochMillis: a.epochMillis ?? 0,
    position: a.position ?? [0, 0, 0],
    velocity: a.velocity ?? [0, 0, 0],
  }));

  if (!isCurrentLaunch(myEpoch)) return; // superseded by a newer launch
  dispatch(setBodyAnchors({ body, anchors, fromMs, toMs }));
});
