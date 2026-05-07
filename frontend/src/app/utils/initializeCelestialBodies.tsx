import { AppDispatch } from "@/app/store/Store";
import {
  loadSimulation,
  SimulationParameters,
} from "@/app/store/slices/SimulationSlice";

// Default to localhost in dev; production builds must set NEXT_PUBLIC_BACKEND_URL.
// Reading at call time (not module load) avoids throwing during Next's static prerender pass.
const DEFAULT_BACKEND_URL = "http://localhost:8080/api/simulation";

export const initializeCelestialBodies = async (
  dispatch: AppDispatch,
  requestBody: any,
) => {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

  try {
    const response = await fetch(`${backendUrl}/initialize`, {
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
