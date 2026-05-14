import {
  createSelector,
  createSlice,
  Middleware,
  PayloadAction,
} from "@reduxjs/toolkit";
import { AppDispatch, RootState } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
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
  // Standard gravitational parameter µ = G·M, units m³/s². Populated from
  // the binary chunk header on the first chunk dispatch (constant per
  // session — backend value is sourced from Orekit's CelestialBody.getGM()).
  // Used by orbital-element computation in the body card.
  mu?: number;
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

export type CameraPreset = "top-down" | "free";

// Display frame is a *render-time* choice independent of the integration
// frame the backend used. Backend snapshots are always Sun-relative
// (Simulation.snapshotFromState shifts by the Sun's state regardless of
// session frame), so switching display frames is just a per-frame pivot
// subtraction on the client — no buffer flush, no resubmit. See todo #42.
//
// Barycentric is intentionally not shipped in Phase 4: a correct bary
// pivot is a mass-weighted average of all bodies, and computing it per
// trail history point per frame is hot-path-expensive. Adding it
// correctly needs a shared per-timestep pivot cache; deferred to keep
// Phase 4 scope tight. Mars retrograde works fine with helio + geo.
export type DisplayFrame = "helio" | "geo";

export interface SimulationParameters {
  celestialBodyPropertiesList: CelestialBodyProperties[];
  simulationMetaData: SimulationMetadata | null;
  lastRequest: LastSimRequest | null;
  showGrid: boolean;
  showAxes: boolean;
  showPlanetInfoOverlay: boolean;
  showTrails: boolean;
  showOrbitPaths: boolean;
  simulationScale: SimulationScale;
  cameraPreset: CameraPreset;
  displayFrame: DisplayFrame;
}

const CAMERA_PRESET_STORAGE_KEY = "spacesim.cameraPreset";
const DISPLAY_FRAME_STORAGE_KEY = "spacesim.displayFrame";

// SSR-safe: callers must NOT use these during module init / initialState
// construction. Reading localStorage at module-load time produces a
// different initial Redux state on server (no window → default) vs client
// (window → stored value), which causes hydration mismatches in any
// SSR'd component that displays the value (e.g. FrameCompass). Use these
// only inside a useEffect, then dispatch setDisplayFrame / setCameraPreset
// to reconcile the store. See PrefsHydrator.tsx.
export function readStoredCameraPreset(): CameraPreset | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(CAMERA_PRESET_STORAGE_KEY);
  return stored === "free" || stored === "top-down" ? stored : null;
}

export function readStoredDisplayFrame(): DisplayFrame | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(DISPLAY_FRAME_STORAGE_KEY);
  return stored === "geo" || stored === "helio" ? stored : null;
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
    // Grid, trail, label defaults match the design's first-paint look —
    // user can toggle off via the bottom-right view chips. Axes stays
    // off (it's a debug overlay; on by default would clutter the demo).
    showGrid: true,
    showAxes: false,
    showPlanetInfoOverlay: true,
    showTrails: true,
    showOrbitPaths: true,
    simulationScale: SimConstants.SCALE.SEMI_REALISTIC, // default scale
    // Hard-coded SSR-safe defaults. localStorage rehydration happens
    // post-mount in PrefsHydrator → setCameraPreset / setDisplayFrame.
    cameraPreset: "top-down",
    displayFrame: "helio",
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
      // Atomic new-session swap. Wiping the chunk buffer + timeState +
      // activeBody alongside the new params prevents stale timesteps from
      // the prior session from rendering with the new scales/textures
      // (and prevents resumed playback at the old scrubber position).
      // View prefs (showGrid, simulationScale, cameraPreset, displayFrame,
      // lastRequest) are intentionally preserved — those are user
      // preferences, not session state. See todo #55.
      state.simulationData = null;
      state.timeState = {
        isPaused: true,
        isUpdating: false,
        speedMultiplier: 1,
        currentTimeStepIndex: 0,
      };
      state.activeBodyState = {
        isBodyActive: false,
        activeBodyName: null,
      };

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
      action: PayloadAction<{
        data: SimulationData;
        mu?: Record<string, number>;
      }>,
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

      // Merge µ from the chunk header into the body properties list. µ is
      // constant per session, but the backend ships it on every chunk to
      // avoid a separate metadata channel — overwriting on each merge is
      // fine and idempotent. µ=0 means "unknown" (backend missing-entry
      // fallback) and is left undefined on the props so downstream code
      // can detect "no µ" rather than computing nonsense from zero.
      const muMap = action.payload.mu;
      if (muMap && state.simulationParameters.celestialBodyPropertiesList) {
        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (!body.name) return body;
              const upperName = body.name.trim().toUpperCase();
              // Match case-insensitively; backend names come from Orekit
              // and frontend list comes from the SimParams form, so
              // capitalisation can drift.
              let mu: number | undefined;
              for (const key of Object.keys(muMap)) {
                if (key.trim().toUpperCase() === upperName) {
                  const value = muMap[key];
                  if (value > 0) mu = value;
                  break;
                }
              }
              return mu !== undefined ? { ...body, mu } : body;
            },
          );
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
    // View toggles are unconditional — the sim-data guard that used to wrap
    // each of these silently dropped clicks before the user had loaded a
    // sim, leaving the chip stuck on whatever its initial-state value was.
    // The scene's render branches already gate on isPaused / data presence
    // separately; the slice flag is just a UI preference.
    toggleShowGrid: (state) => {
      state.simulationParameters.showGrid = !state.simulationParameters.showGrid;
    },
    toggleShowAxes: (state) => {
      state.simulationParameters.showAxes = !state.simulationParameters.showAxes;
    },
    toggleShowPlanetInfoOverlay: (state) => {
      state.simulationParameters.showPlanetInfoOverlay =
        !state.simulationParameters.showPlanetInfoOverlay;
    },
    toggleShowTrails: (state) => {
      state.simulationParameters.showTrails =
        !state.simulationParameters.showTrails;
    },
    toggleShowOrbitPaths: (state) => {
      state.simulationParameters.showOrbitPaths =
        !state.simulationParameters.showOrbitPaths;
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
    toggleCameraPreset: (state: SimulationState) => {
      const next: CameraPreset =
        state.simulationParameters.cameraPreset === "top-down"
          ? "free"
          : "top-down";
      state.simulationParameters.cameraPreset = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, next);
      }
    },
    // Direct setter (vs. toggleCameraPreset). Used by PrefsHydrator on
    // mount to reconcile the SSR-safe initial state with the value
    // persisted in localStorage. Writes through to storage so it stays
    // a no-op if the user calls it with the already-stored value.
    setCameraPreset: (
      state: SimulationState,
      action: PayloadAction<CameraPreset>,
    ) => {
      state.simulationParameters.cameraPreset = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, action.payload);
      }
    },
    cycleDisplayFrame: (state: SimulationState) => {
      // helio → geo → helio. Bary deferred — see DisplayFrame type comment.
      const next: DisplayFrame =
        state.simulationParameters.displayFrame === "helio" ? "geo" : "helio";
      state.simulationParameters.displayFrame = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISPLAY_FRAME_STORAGE_KEY, next);
      }
    },
    // Direct setter — see setCameraPreset's comment for rationale.
    setDisplayFrame: (
      state: SimulationState,
      action: PayloadAction<DisplayFrame>,
    ) => {
      state.simulationParameters.displayFrame = action.payload;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISPLAY_FRAME_STORAGE_KEY, action.payload);
      }
    },
    setIsBodyActive: (
      state: SimulationState,
      action: PayloadAction<boolean>,
    ) => {
      console.log("payload: ", action.payload);
      state.activeBodyState.isBodyActive = action.payload;
    },
    cycleSimulationScale: (state) => {
      // Same reasoning as the view toggles above — the simulationData
      // guard dropped pre-sim clicks. The body-list re-mapping further
      // down has its own guard so it's still safe before bodies exist.
      if (state.simulationParameters.simulationScale) {
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
        dispatchChunkRequest(store.dispatch as AppDispatch, requestData);
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

export const selectShowOrbitPaths = (state: RootState) =>
  state.simulation.simulationParameters.showOrbitPaths;

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

export const selectCameraPreset = (state: RootState) =>
  state.simulation.simulationParameters?.cameraPreset ?? "top-down";

export const selectDisplayFrame = (state: RootState): DisplayFrame =>
  state.simulation.simulationParameters?.displayFrame ?? "helio";

export const {
  loadSimulation,
  updateDataReceived,
  togglePause,
  toggleShowGrid,
  toggleShowAxes,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  toggleShowOrbitPaths,
  deleteExcessData,
  setIsUpdating,
  setIsPaused,
  cycleSimulationScale,
  setSpeedMultiplier,
  setCurrentTimeStepIndex,
  setActiveBody,
  setIsBodyActive,
  setLastSimRequest,
  toggleCameraPreset,
  setCameraPreset,
  cycleDisplayFrame,
  setDisplayFrame,
} = simulationSlice.actions;

export default simulationSlice.reducer;
