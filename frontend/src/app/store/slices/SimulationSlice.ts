import {
  createSelector,
  createSlice,
  Middleware,
  PayloadAction,
} from "@reduxjs/toolkit";
import { AppDispatch, RootState } from "@/app/store/Store";
import { requestRunSimulation } from "@/app/store/middleware/simulationRequestThunk";
import SimConstants, {
  BodyProperties,
  bodyProperties,
} from "@/app/constants/SimConstants";
import { StaticImageData } from "next/image";

interface TimeState {
  isPaused: boolean;
  isUpdating: boolean;
  speedMultiplier: number;
  currentTimeStepIndex: number;
}

export interface Vector3Simple {
  x: number;
  y: number;
  z: number;
}

export interface CelestialBody {
  name: string;
  position: Vector3Simple;
  velocity: Vector3Simple;
}

export interface CelestialBodyProperties {
  mass?: number;
  radius?: number;
  name?: string;
  orbitingBody?: string;
  positionScale?: number;
  texture?: StaticImageData;
}

interface SimulationMetadata {
  sessionID: string;
}

// Snapshot of the most recent SimParams form submission. Surfaces as the
// real values for Frame / Integrator / Δt readouts in the top status
// strip; also feeds the BUFFER seconds calculation. Distinct from
// `simulationMetaData` (which is sessionID only — backend-driven).
export interface LastSimRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: string;
}

interface ActiveBodyState {
  isBodyActive: boolean;
  activeBodyName: string | null;
}

export interface SimulationData {
  [date: string]: CelestialBody[];
}

export interface SimulationScale {
  // set in SimConstants
  name: string;
  positionScale: number;
  radiusScale: number;
  EXCEPTION_BODIES_POSITION_SCALE: { [bodyName: string]: number };
  GRID: {
    SIZE: number;
    SEGMENTS: number;
  };
  AXES: {
    SIZE: number;
  };
}

export interface SimulationParameters {
  celestialBodyPropertiesList: CelestialBodyProperties[];
  simulationMetaData: SimulationMetadata | null;
  lastRequest: LastSimRequest | null;
  showGrid: boolean;
  showAxes: boolean;
  showPlanetInfoOverlay: boolean;
  showTrails: boolean;
  simulationScale: SimulationScale;
}

interface SimulationState {
  activeBodyState: ActiveBodyState;
  simulationParameters: SimulationParameters;
  simulationData: SimulationData | null;
  timeState: TimeState;
}

// this is mandatory; passed to createSlice
const initialState: SimulationState = {
  activeBodyState: {
    isBodyActive: false,
    activeBodyName: null,
  },
  simulationParameters: {
    celestialBodyPropertiesList: [],
    simulationMetaData: null,
    lastRequest: null,
    showGrid: false,
    showAxes: false,
    showPlanetInfoOverlay: false,
    showTrails: true,
    simulationScale: SimConstants.SCALE.SEMI_REALISTIC, // default scale
  },
  simulationData: null,
  timeState: {
    isPaused: true,
    isUpdating: false,
    speedMultiplier: 1,
    currentTimeStepIndex: 0,
  },
};

export const simulationSlice = createSlice({
  name: "simulation",
  initialState,
  reducers: {
    loadSimulation: (state, action: PayloadAction<SimulationParameters>) => {
      state.simulationParameters = {
        ...state.simulationParameters,
        ...action.payload,
      };

      if (
        state.simulationParameters &&
        state.simulationParameters.celestialBodyPropertiesList
      ) {
        const exceptionMap =
          state.simulationParameters.simulationScale
            ?.EXCEPTION_BODIES_POSITION_SCALE || {};

        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (body.name) {
                const upperName = body.name.trim().toUpperCase();
                // Determine the new positionScale: if there's an exception, use it; otherwise, default to 1.
                const newPositionScale =
                  exceptionMap[upperName] !== undefined
                    ? exceptionMap[upperName]
                    : 1;
                // look up default constants (e.g textures)
                const defaults: BodyProperties = bodyProperties[upperName];
                // Merge defaults into the body properties.
                return {
                  ...body,
                  ...defaults,
                  positionScale: newPositionScale,
                };
              }
              return { ...body, positionScale: 1 };
            },
          );
      }
      console.log(
        "load sim: ",
        state.simulationParameters.celestialBodyPropertiesList,
        "scale:",
        state.simulationParameters.simulationScale,
      );
    },

    updateDataReceived: (
      state,
      action: PayloadAction<{ data: SimulationData }>,
    ) => {
      if (!state.simulationData) {
        state.simulationData = action.payload.data;
      } else {
        state.simulationData = {
          ...state.simulationData,
          ...action.payload.data,
        };
        console.log("Simulation data updated:", state.simulationData);
      }
      // unlock rendering loop
      state.timeState.isUpdating = false;
      state.timeState.isPaused = false;
    },
    deleteExcessData: (
      state,
      action: PayloadAction<{ excessCount: number; timeStepKeys: string[] }>,
    ) => {
      const { simulationData } = state;
      if (!simulationData) return;

      const { excessCount, timeStepKeys } = action.payload;

      // Remove the earliest indices
      const keysToRemove = timeStepKeys.slice(0, excessCount);
      keysToRemove.forEach((key) => {
        delete simulationData[key];
      });

      // Adjust currentTimeStepIndex
      state.timeState.currentTimeStepIndex = Math.max(
        0,
        state.timeState.currentTimeStepIndex - excessCount,
      );
    },
    togglePause: (state) => {
      state.timeState.isPaused = !state.timeState.isPaused;
    },
    toggleShowGrid: (state) => {
      if (state.simulationData) {
        state.simulationParameters.showGrid =
          !state.simulationParameters.showGrid;
      }
    },
    toggleShowAxes: (state) => {
      if (state.simulationData) {
        state.simulationParameters.showAxes =
          !state.simulationParameters.showAxes;
      }
    },
    toggleShowPlanetInfoOverlay: (state) => {
      if (state.simulationData) {
        state.simulationParameters.showPlanetInfoOverlay =
          !state.simulationParameters.showPlanetInfoOverlay;
      }
    },
    toggleShowTrails: (state) => {
      if (state.simulationData) {
        state.simulationParameters.showTrails =
          !state.simulationParameters.showTrails;
      }
    },

    setIsUpdating: (state, action: PayloadAction<boolean>) => {
      state.timeState.isUpdating = action.payload;
    },
    setIsPaused: (state, action: PayloadAction<boolean>) => {
      state.timeState.isPaused = action.payload;
    },

    setCurrentTimeStepIndex: (state, action: PayloadAction<number>) => {
      state.timeState.currentTimeStepIndex = action.payload;
    },
    setSpeedMultiplier: (state, action: PayloadAction<string>) => {
      const { speedMultiplier } = state.timeState;
      let newMultiplier: number = speedMultiplier;
      if (action.payload === "increase") {
        if (speedMultiplier < -1) {
          newMultiplier = speedMultiplier / 2;
        } else if (speedMultiplier === -1) {
          newMultiplier = 1;
        } else {
          newMultiplier = speedMultiplier * 2;
        }
      } else if (action.payload === "decrease") {
        if (speedMultiplier > 1) {
          newMultiplier = speedMultiplier / 2;
        } else if (speedMultiplier === 1) {
          newMultiplier = -1;
        } else {
          newMultiplier = speedMultiplier * 2;
        }
      }
      state.timeState.speedMultiplier = Math.min(
        Math.max(newMultiplier, -SimConstants.MAX_SPEED_MULTIPLIER),
        SimConstants.MAX_SPEED_MULTIPLIER,
      );
    },
    setActiveBody: (
      state: SimulationState,
      action: PayloadAction<string>,
    ) => {
      state.activeBodyState.activeBodyName = action.payload;
      state.activeBodyState.isBodyActive = true;
    },
    setLastSimRequest: (
      state: SimulationState,
      action: PayloadAction<LastSimRequest>,
    ) => {
      state.simulationParameters.lastRequest = action.payload;
    },
    setIsBodyActive: (
      state: SimulationState,
      action: PayloadAction<boolean>,
    ) => {
      console.log("payload: ", action.payload);
      state.activeBodyState.isBodyActive = action.payload;
    },
    cycleSimulationScale: (state) => {
      if (state.simulationParameters.simulationScale && state.simulationData) {
        const currentScale = state.simulationParameters.simulationScale;
        const scaleOptions: string[] = Object.keys(SimConstants.SCALE); //ES6 objects have defined insertion order
        // for string keys

        const currentIndex = scaleOptions.findIndex((key) => {
          const preset =
            SimConstants.SCALE[key as keyof typeof SimConstants.SCALE];
          return (
            preset.positionScale === currentScale.positionScale &&
            preset.radiusScale === currentScale.radiusScale
          );
        });

        const nextIndex: number = (currentIndex + 1) % scaleOptions.length;
        const nextKey = scaleOptions[
          nextIndex
        ] as keyof typeof SimConstants.SCALE;

        state.simulationParameters.simulationScale =
          SimConstants.SCALE[nextKey];

        const exceptions =
          state.simulationParameters.simulationScale
            .EXCEPTION_BODIES_POSITION_SCALE;

        // for exceptions (e.g Moon), map the custom position scale from SimConstants. we need to tweak the position
        // scale here because otherwise we end up with cases like the moon being rendered in the earth, since the
        // radius-position ratio is not aligned
        if (
          exceptions &&
          state.simulationParameters.celestialBodyPropertiesList
        ) {
          state.simulationParameters.celestialBodyPropertiesList =
            state.simulationParameters.celestialBodyPropertiesList.map(
              (bodyProps) => {
                if (
                  bodyProps.name &&
                  exceptions[bodyProps.name.toUpperCase()] !== undefined
                ) {
                  return {
                    ...bodyProps,
                    positionScale: exceptions[bodyProps.name.toUpperCase()],
                  };
                }
                return bodyProps;
              },
            );
        }
      }
    },
  },
});

///////////////////////////////////////////// MIDDLEWARE /////////////////////////////////////////////

type IndexAction = { type: string; payload: number };

// intercepts the rendering loop as 1st step; runs logic to get new data batch if < n iterations left
export const simulationUpdateDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const a = action as IndexAction;
    if (a.type === "simulation/setCurrentTimeStepIndex") {
      const state = store.getState() as RootState;

      const simulationData = state.simulation.simulationData;
      if (!simulationData) {
        console.warn("simulationData is not available yet.");
        return next(action);
      }

      const totalTimeSteps = selectTotalTimeSteps(state);
      const currentTimeStepIndex = a.payload;
      const remainingIndexes = totalTimeSteps - currentTimeStepIndex;

      if (remainingIndexes <= 9000 && !state.request.isRequestInProgress) {
        const sessionID = selectSessionID(state);
        if (!sessionID) {
          console.warn("Session ID is not defined. Cannot send request.");
          return next(action);
        }

        const requestData = { sessionID };
        (store.dispatch as AppDispatch)(requestRunSimulation(requestData));
      }
    }
    return next(action);
  };

///////////////////////////////////////////// SELECTORS /////////////////////////////////////////////
export const selectTimeStepKeys = createSelector(
  (state: RootState) => state.simulation.simulationData,
  (simulationData: SimulationData | null) => {
    if (!simulationData) {
      return [];
    }
    return Object.keys(simulationData);
  },
);

export const selectSimulationDataSize = createSelector(
  (state: RootState) => state.simulation.simulationData,
  (simulationData: SimulationData | null): number => {
    if (!simulationData) return 0;
    const jsonString = JSON.stringify(simulationData);
    return new Blob([jsonString]).size; // Size in bytes
  },
);

export const selectTotalTimeSteps = createSelector(
  (state: RootState) => state.simulation.simulationData,
  (simulationData: SimulationData | null): number =>
    simulationData ? Object.keys(simulationData).length : 0,
);

export const selectBodyRadiusFromName = createSelector(
  [
    (state: RootState) =>
      state.simulation.simulationParameters?.celestialBodyPropertiesList,
    (state: RootState, props: { bodyName: string }) => props.bodyName,
  ],
  (
    celestialBodyPropertiesList: CelestialBodyProperties[],
    bodyName: string,
  ): number | undefined => {
    const bodyProps: CelestialBodyProperties | undefined =
      celestialBodyPropertiesList.find(
        (cb: CelestialBodyProperties): boolean =>
          cb.name?.trim().toLowerCase() === bodyName.trim().toLowerCase(),
      );
    return bodyProps?.radius;
  },
);

export const selectShowGrid = (state: RootState) =>
  state.simulation.simulationParameters.showGrid;

export const selectShowAxes = (state: RootState) =>
  state.simulation.simulationParameters.showAxes;

export const selectShowPlanetInfoOverlay = (state: RootState) =>
  state.simulation.simulationParameters.showPlanetInfoOverlay;

export const selectShowTrails = (state: RootState) =>
  state.simulation.simulationParameters.showTrails;

export const selectSimulationScale = (state: RootState) =>
  state.simulation.simulationParameters.simulationScale;

export const selectActiveBodyName = (state: RootState) =>
  state.simulation.activeBodyState.activeBodyName;

export const selectIsBodyActive = (state: RootState) =>
  state.simulation.activeBodyState.isBodyActive;

export const selectCurrentTimeStepIndex = (state: RootState) =>
  state.simulation.timeState.currentTimeStepIndex;

export const selectCelestialBodyPropertiesList = (state: RootState) =>
  state.simulation.simulationParameters?.celestialBodyPropertiesList;

export const selectIsPaused = (state: RootState) =>
  state.simulation.timeState.isPaused;

export const selectSpeedMultiplier = (state: RootState) =>
  state.simulation.timeState.speedMultiplier;

export const selectCurrentTimeStepKey = createSelector(
  [
    (state: RootState) => state.simulation.simulationData,
    (state: RootState) => state.simulation.timeState.currentTimeStepIndex,
  ],
  (simulationData: SimulationData | null, idx: number): string => {
    if (!simulationData) return "";
    const keys = Object.keys(simulationData);
    return keys[idx] ?? "";
  },
);

export const selectIsUpdating = (state: RootState) =>
  state.simulation.timeState.isUpdating;

export const selectSessionID = (state: RootState) =>
  state.simulation.simulationParameters?.simulationMetaData?.sessionID;

export const selectLastSimRequest = (state: RootState) =>
  state.simulation.simulationParameters?.lastRequest;

export const {
  loadSimulation,
  updateDataReceived,
  togglePause,
  toggleShowGrid,
  toggleShowAxes,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  deleteExcessData,
  setIsUpdating,
  setIsPaused,
  cycleSimulationScale,
  setSpeedMultiplier,
  setCurrentTimeStepIndex,
  setActiveBody,
  setIsBodyActive,
  setLastSimRequest,
} = simulationSlice.actions;

export default simulationSlice.reducer;
