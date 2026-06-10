import { AppDispatch } from "@/app/store/Store";
import { loadSimulation } from "@/app/store/slices/SimulationSlice";
import { setErrorMessage } from "@/app/store/slices/RequestSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { components } from "@/app/generated/api";

// Request/response shapes are generated from the backend OpenAPI spec, so a
// backend DTO change surfaces as a TypeScript error here rather than a silent
// runtime undefined. The explicit field reads below
// (data.celestialBodyPropertiesList, data.simulationMetaData.sessionID) are the
// drift catch: a renamed wire field fails to compile at the access site.
type InitializeRequest = components["schemas"]["SimulationRequestDTO"];
type InitializeResponse = components["schemas"]["SimulationResponseDTO"];

// Statuses that mean "the backend isn't ready yet, try again". The backend
// sleeps when idle (to stay within a small hosting budget) and the first
// request after a sleep can return 502 for a few seconds while it wakes; 503
// and 504 are transient gateway/availability blips. Everything else (429 too
// many requests, 400 bad request) is surfaced immediately.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

// Absorb the cold start: retry with growing backoff over ~20s so the first
// visitor after an idle stretch sees a short "waking up" wait, not an error.
const RETRY_DELAYS_MS = [1000, 2000, 3000, 5000, 8000];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface InitializeOptions {
  // Called once before each retry wait, so the caller can swap in a
  // "waking up" message after the first failed attempt.
  onRetry?: (nextAttempt: number) => void;
}

/**
 * Starts a simulation session. Returns true on success. On failure it surfaces
 * a plain-English message via the error toast and returns false (it does not
 * throw), so the caller can simply branch on the boolean.
 */
export const initializeCelestialBodies = async (
  dispatch: AppDispatch,
  requestBody: InitializeRequest,
  options: InitializeOptions = {},
): Promise<boolean> => {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const isLastAttempt = attempt === maxAttempts - 1;
    try {
      const response = await fetch(`${REST_URL}/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data: InitializeResponse = await response.json();
        dispatch(
          loadSimulation({
            celestialBodyPropertiesList: data.celestialBodyPropertiesList ?? [],
            simulationMetaData: data.simulationMetaData
              ? { sessionID: data.simulationMetaData.sessionID ?? "" }
              : null,
          }),
        );
        return true;
      }

      // Non-OK: retry the cold-wake / transient gateway statuses; surface
      // everything else right away.
      if (!RETRYABLE_STATUSES.has(response.status) || isLastAttempt) {
        dispatch(setErrorMessage(messageForStatus(response.status)));
        return false;
      }
    } catch (error) {
      // Network-level failure (offline, DNS, connection refused). Treat as
      // transient and retry until the attempt budget is spent.
      if (isLastAttempt) {
        console.error("Failed to reach the simulator:", error);
        dispatch(
          setErrorMessage(
            "Could not reach the simulator. It may be starting up. Please try again in a moment.",
          ),
        );
        return false;
      }
    }

    options.onRetry?.(attempt + 1);
    await delay(RETRY_DELAYS_MS[attempt]);
  }

  return false;
};

function messageForStatus(status: number): string {
  if (status === 429) {
    return "You are sending requests a little too quickly. Please wait a moment and try again.";
  }
  if (status === 503) {
    return "The simulator is busy right now. Please try again in a minute.";
  }
  if (status === 400) {
    return "That simulation could not be set up. Please check your selection and try again.";
  }
  return "Could not start the simulation. It may be starting up. Please try again in a moment.";
}
