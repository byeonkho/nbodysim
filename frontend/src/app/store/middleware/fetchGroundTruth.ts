import { createAsyncThunk } from "@reduxjs/toolkit";
import { REST_URL } from "@/app/utils/backendUrls";
import { setBodyAnchors } from "@/app/store/slices/GroundTruthSlice";
import { setErrorMessage } from "@/app/store/slices/RequestSlice";
import { currentLaunchEpoch, isCurrentLaunch } from "@/app/store/launchEpoch";
import type { components } from "@/app/generated/api";
import type { AppDispatch, RootState } from "@/app/store/Store";

type GroundTruthResponse = components["schemas"]["GroundTruthResponse"];

interface FetchArgs {
  frame: string; // backend frame CODE (e.g. "heliocentric"), not the display label
  body: string; // single focused body (active-only fetching)
  fromMs: number;
  toMs: number;
  epochsMillis?: number[];
  referenceEpochs?: number[];
  stepSeconds: number; // cadence sized to the visible window by the caller
  subtractSun: boolean; // mirror the predicted Sun convention (Sun in session?)
  // True for a user-initiated fetch (toggling Drift, switching the focused
  // body), false for an automatic background top-up. Read off action.meta.arg
  // by the slice to gate the loading notice, and here to gate error surfacing:
  // only a fetch the user is actively waiting on raises a toast on failure, so
  // a transient background refetch failure (which retries) stays silent.
  immediate: boolean;
}

// Plain-English toast for a failed user-initiated fetch. Shown via the shared
// error toast so the user who just turned on Drift learns the load failed
// instead of staring at an overlay that never appears.
const GROUND_TRUTH_ERROR_COPY =
  "Could not load the real-world positions. Toggle Drift to try again.";

const latestRequestByBody = new Map<string, string>();

// Fetches the active body's true track for a visible window and REPLACES that
// body's anchors. Active-body-only keeps the recurring fetch small; replace
// (not merge) means a stale or overlapping response can't corrupt the anchor
// ordering. A failure is a no-op on the core sim (side channel).
export const fetchGroundTruth = createAsyncThunk<
  void,
  FetchArgs,
  { state: RootState; dispatch: AppDispatch }
>(
  "groundTruth/fetch",
  async (
    {
      frame,
      body,
      fromMs,
      toMs,
      stepSeconds,
      referenceEpochs,
      subtractSun,
      immediate,
    },
    { dispatch, requestId },
  ) => {
    // Bind this fetch to the launch that started it. A resubmit bumps the
    // launch epoch (and resets the anchors); if that happened while this was
    // in flight, dropping it keeps the stale window from repopulating.
    const myEpoch = currentLaunchEpoch();
    const key = body.toUpperCase();
    latestRequestByBody.set(key, requestId);
    const ownsRequest = () =>
      isCurrentLaunch(myEpoch) && latestRequestByBody.get(key) === requestId;

    const url =
      `${REST_URL}/ground-truth?body=${encodeURIComponent(body)}` +
      `&frame=${encodeURIComponent(frame)}` +
      `&fromEpoch=${fromMs}&toEpoch=${toMs}&stepSeconds=${stepSeconds}` +
      `&subtractSun=${subtractSun}`;

    let data: GroundTruthResponse;
    try {
      const response = referenceEpochs
        ? await fetch(`${REST_URL}/ground-truth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, frame, referenceEpochs, subtractSun }),
          })
        : await fetch(url, { method: "GET" });
      if (!ownsRequest()) return;
      if (!response.ok) {
        console.warn(`ground-truth fetch failed: HTTP ${response.status}`);
        if (immediate && ownsRequest())
          dispatch(setErrorMessage(GROUND_TRUTH_ERROR_COPY));
        return;
      }
      data = await response.json();
    } catch (err) {
      // Network-level failure (offline, reset). The simulation carries on.
      console.warn("ground-truth fetch failed:", err);
      if (immediate && ownsRequest())
        dispatch(setErrorMessage(GROUND_TRUTH_ERROR_COPY));
      return;
    }

    const track = (data.tracks ?? []).find(
      (t) => (t.name ?? "").toUpperCase() === body.toUpperCase(),
    );
    // Empty anchors when the body is unsupported (moon / minor body): we still
    // record the covered window so the middleware doesn't refetch on every chunk.
    const anchors = (track?.anchors ?? []).map((a) => ({
      epochMillis: a.epochMillis ?? 0,
      referenceEpoch: a.referenceEpoch,
      position: a.position ?? [0, 0, 0],
      velocity: a.velocity ?? [0, 0, 0],
    }));

    if (!ownsRequest()) return; // superseded by a newer launch
    dispatch(
      setBodyAnchors({
        body,
        anchors,
        fromMs: anchors.length
          ? (anchors[0].referenceEpoch ?? anchors[0].epochMillis)
          : fromMs,
        toMs: anchors.length
          ? (anchors[anchors.length - 1].referenceEpoch ??
            anchors[anchors.length - 1].epochMillis)
          : toMs,
      }),
    );
  },
);
