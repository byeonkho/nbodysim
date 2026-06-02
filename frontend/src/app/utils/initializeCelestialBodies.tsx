import { AppDispatch } from "@/app/store/Store";
import { loadSimulation } from "@/app/store/slices/SimulationSlice";
import { REST_URL } from "@/app/utils/backendUrls";
import type { components } from "@/app/generated/api";

// Request/response shapes are generated from the backend OpenAPI spec, so a
// backend DTO change surfaces as a TypeScript error here rather than a silent
// runtime undefined. The explicit field reads below
// (data.celestialBodyPropertiesList, data.simulationMetaData.sessionID) are the
// drift catch: a renamed wire field fails to compile at the access site. See
// the API contract drift gate (todo #33).
type InitializeRequest = components["schemas"]["SimulationRequestDTO"];
type InitializeResponse = components["schemas"]["SimulationResponseDTO"];

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

    const data: InitializeResponse = await response.json();

    dispatch(
      loadSimulation({
        celestialBodyPropertiesList: data.celestialBodyPropertiesList ?? [],
        simulationMetaData: data.simulationMetaData
          ? { sessionID: data.simulationMetaData.sessionID ?? "" }
          : null,
      }),
    );
  } catch (error) {
    console.error("Failed to load celestial objects data:", error);
  }
};
