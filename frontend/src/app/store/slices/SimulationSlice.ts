import {
  createSelector,
  createSlice,
  Middleware,
  PayloadAction,
} from "@reduxjs/toolkit";
import { AppDispatch, RootState } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import {
  appendChunk,
  ChunkBuffer,
  computeBufferCapacity,
  createChunkBuffer,
  getTimestampAsIsoString,
  selectBufferByteBudget,
} from "@/app/store/chunkBuffer";
import SimConstants, {
  BodyProperties,
  bodyProperties,
} from "@/app/constants/SimConstants";
import { StaticImageData } from "next/image";
import { selectFetchLatencyEmaMs } from "@/app/store/slices/RequestSlice";

interface TimeState {
  isPaused: boolean;
  speedMultiplier: number;
  currentTimeStepIndex: number;
}

export interface Vector3Simple {
  x: number;
  y: number;
  z: number;
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
  /** Optional — populated by SimSetupDrawer Phase 3 onward. */
  keyframeIntervalSec?: number;
}

interface ActiveBodyState {
  isBodyActive: boolean;
  activeBodyName: string | null;
}

export interface SimulationScale {
  // set in SimConstants
  name: string;
  positionScale: number;
  radiusScale: number;
  EXCEPTION_BODIES_POSITION_SCALE: { [bodyName: string]: number };
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
  chunkBuffer: ChunkBuffer | null;
  hasReceivedFirstChunk: boolean;
  timeState: TimeState;
}

const initialState: SimulationState = {
  activeBodyState: {
    isBodyActive: false,
    activeBodyName: null,
  },
  simulationParameters: {
    celestialBodyPropertiesList: [],
    simulationMetaData: null,
    lastRequest: null,
    showGrid: true,
    showAxes: false,
    showPlanetInfoOverlay: true,
    showTrails: true,
    showOrbitPaths: true,
    simulationScale: SimConstants.SCALE.SEMI_REALISTIC,
    cameraPreset: "top-down",
    displayFrame: "helio",
  },
  chunkBuffer: null,
  hasReceivedFirstChunk: false,
  timeState: {
    isPaused: true,
    speedMultiplier: 1,
    currentTimeStepIndex: 0,
  },
};

interface AppendChunkPayload {
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: BigInt64Array;
  mu: Record<string, number>;
}

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
      state.chunkBuffer = null;
      state.hasReceivedFirstChunk = false;
      state.timeState = {
        isPaused: true,
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

      if (state.simulationParameters?.celestialBodyPropertiesList) {
        const exceptionMap =
          state.simulationParameters.simulationScale
            ?.EXCEPTION_BODIES_POSITION_SCALE || {};

        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (body.name) {
                const upperName = body.name.trim().toUpperCase();
                const newPositionScale =
                  exceptionMap[upperName] !== undefined
                    ? exceptionMap[upperName]
                    : 1;
                const defaults: BodyProperties = bodyProperties[upperName];
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
    },

    appendChunkToBuffer: (state, action: PayloadAction<AppendChunkPayload>) => {
      const payload = action.payload;

      // First chunk creates the buffer at the session-start capacity.
      if (state.chunkBuffer === null) {
        const byteBudget = selectBufferByteBudget();
        const capacity = computeBufferCapacity(payload.bodyCount, byteBudget);
        state.chunkBuffer = createChunkBuffer(payload.bodyNames, capacity);
        console.info(
          `[buffer] budget=${(byteBudget / 1024 / 1024) | 0}MB ` +
            `capacity=${capacity} timesteps (${payload.bodyCount} bodies)`,
        );
      }

      const shifted = appendChunk(
        state.chunkBuffer,
        payload.positions,
        payload.timestamps,
        payload.timestepCount,
      );

      // If eviction occurred, slide the playback head left by the same amount
      // so the user keeps watching the same simulation moment, not a moment
      // that just got dropped from the buffer.
      if (shifted > 0) {
        state.timeState.currentTimeStepIndex = Math.max(
          0,
          state.timeState.currentTimeStepIndex - shifted,
        );
      }

      // Merge µ from the chunk header into the body properties list. µ is
      // constant per session, but the backend ships it on every chunk to
      // avoid a separate metadata channel — overwriting on each merge is
      // fine and idempotent. µ=0 means "unknown" (backend missing-entry
      // fallback) and is left undefined on the props so downstream code
      // can detect "no µ" rather than computing nonsense from zero.
      if (state.simulationParameters.celestialBodyPropertiesList) {
        const muMap = payload.mu;
        state.simulationParameters.celestialBodyPropertiesList =
          state.simulationParameters.celestialBodyPropertiesList.map(
            (body: CelestialBodyProperties): CelestialBodyProperties => {
              if (!body.name) return body;
              const upperName = body.name.trim().toUpperCase();
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

      state.hasReceivedFirstChunk = true;
    },

    togglePause: (state) => {
      state.timeState.isPaused = !state.timeState.isPaused;
    },
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
      const next: DisplayFrame =
        state.simulationParameters.displayFrame === "helio" ? "geo" : "helio";
      state.simulationParameters.displayFrame = next;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISPLAY_FRAME_STORAGE_KEY, next);
      }
    },
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
      state.activeBodyState.isBodyActive = action.payload;
    },
    cycleSimulationScale: (state) => {
      if (state.simulationParameters.simulationScale) {
        const currentScale = state.simulationParameters.simulationScale;
        const scaleOptions: string[] = Object.keys(SimConstants.SCALE);

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

const PREFETCH_MIN_THRESHOLD = 1000;
const PREFETCH_SAFETY_FACTOR = 1.5;

// Speed-aware prefetch trigger. Threshold scales with playback rate so that
// at high speedMultipliers, the next fetch is in flight well before the
// buffer empties. EMA of recent fetch latencies feeds the formula so the
// threshold adapts to actual network + compute conditions.
export const simulationUpdateDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const a = action as IndexAction;
    if (a.type === "simulation/setCurrentTimeStepIndex") {
      const state = store.getState() as RootState;
      const buffer = state.simulation.chunkBuffer;
      if (!buffer) return next(action);

      const currentTimeStepIndex = a.payload;
      const remaining = buffer.totalTimesteps - currentTimeStepIndex;
      const speedMultiplier = Math.abs(state.simulation.timeState.speedMultiplier);
      const fps = SimConstants.FPS;
      const fetchLatencyMs = selectFetchLatencyEmaMs(state);

      const stepsConsumedDuringFetch =
        speedMultiplier * fps * (fetchLatencyMs / 1000);
      const threshold = Math.max(
        PREFETCH_MIN_THRESHOLD,
        Math.ceil(stepsConsumedDuringFetch * PREFETCH_SAFETY_FACTOR),
      );

      if (remaining <= threshold && !state.request.isRequestInProgress) {
        const sessionID = selectSessionID(state);
        if (sessionID) {
          dispatchChunkRequest(store.dispatch as AppDispatch, { sessionID });
        }
      }
    }
    return next(action);
  };

///////////////////////////////////////////// SELECTORS /////////////////////////////////////////////

export const selectChunkBuffer = (state: RootState): ChunkBuffer | null =>
  state.simulation.chunkBuffer;

export const selectTotalTimeSteps = (state: RootState): number =>
  state.simulation.chunkBuffer?.totalTimesteps ?? 0;

export const selectCurrentTimeStepIsoString = createSelector(
  [
    (state: RootState) => state.simulation.chunkBuffer,
    (state: RootState) => state.simulation.timeState.currentTimeStepIndex,
  ],
  (buffer: ChunkBuffer | null, idx: number): string => {
    if (!buffer) return "";
    return getTimestampAsIsoString(buffer, idx);
  },
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

export const selectSessionID = (state: RootState) =>
  state.simulation.simulationParameters?.simulationMetaData?.sessionID;

export const selectLastSimRequest = (state: RootState) =>
  state.simulation.simulationParameters?.lastRequest;

export const selectCameraPreset = (state: RootState) =>
  state.simulation.simulationParameters?.cameraPreset ?? "top-down";

export const selectDisplayFrame = (state: RootState): DisplayFrame =>
  state.simulation.simulationParameters?.displayFrame ?? "helio";

export const selectHasReceivedFirstChunk = (state: RootState): boolean =>
  state.simulation.hasReceivedFirstChunk;

export const {
  loadSimulation,
  appendChunkToBuffer,
  togglePause,
  toggleShowGrid,
  toggleShowAxes,
  toggleShowPlanetInfoOverlay,
  toggleShowTrails,
  toggleShowOrbitPaths,
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
