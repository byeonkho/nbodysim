import { AppDispatch } from "@/app/store/Store";
import {
  loadSimulation,
  SimulationParameters,
} from "@/app/store/slices/SimulationSlice";
import { REST_URL } from "@/app/utils/backendUrls";

interface InitializeRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: string;
  /**
   * Fidelity bucket — user-facing quality preset. Backend resolves to
   * per-integrator K (fixed-step) or N (DP853). Optional — null/omitted
   * → backend uses per-integrator landing default from
   * {@code FidelityBucket.defaultFor()}. One of: "low" | "medLow" |
   * "medium" | "medHigh" | "high".
   */
  fidelityBucket?: string;
}

export const initializeCelestialBodies = async (
  dispatch: AppDispatch,
  requestBody: InitializeRequest,
) => {
  try {
    const response = await fetch(`${REST_URL}/initialize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: SimulationParameters = await response.json();

    // Dispatch the loadSimulationData action with the fetched data
    dispatch(loadSimulation(data));
  } catch (error) {
    console.error("Failed to load celestial objects data:", error);
  }
};
