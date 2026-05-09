import type { Middleware } from "@reduxjs/toolkit";
import { pushEvent } from "@/app/store/slices/EventLogSlice";

// Translates user-driven slice actions into USR entries for the event
// log card. Runs after next() so reads see the new state — necessary
// for togglePause-style actions whose meaning depends on the resulting
// flag, not the action.type alone.
//
// Guard: never recurse on pushEvent itself.
//
// Note: RootState is reified through the store's getState rather than
// imported as a type, since this file is itself imported by Store.ts —
// importing RootState here would form a cycle and TS rejects the
// `userActionLogger: Middleware<unknown, RootState>` annotation.

interface KnownAction {
  type: string;
  payload?: unknown;
}

interface SliceShape {
  simulation: {
    timeState: { isPaused: boolean; speedMultiplier: number };
    simulationParameters: {
      simulationScale: { name: string };
      showGrid: boolean;
      showAxes: boolean;
      showTrails: boolean;
      showPlanetInfoOverlay: boolean;
      lastRequest: {
        celestialBodyNames: string[];
        integrator: string;
        frame: string;
      } | null;
    };
    activeBodyState: { activeBodyName: string | null };
  };
}

export const userActionLogger: Middleware =
  (store) => (next) => (action) => {
    const result = next(action);
    const a = action as KnownAction;

    if (a.type === "eventLog/pushEvent") return result;

    const message = describe(a, store.getState() as SliceShape);
    if (message) {
      store.dispatch(
        pushEvent({ source: "USR", severity: "user", message }),
      );
    }
    return result;
  };

function describe(action: KnownAction, state: SliceShape): string | null {
  switch (action.type) {
    case "simulation/togglePause":
      return state.simulation.timeState.isPaused ? "Paused" : "Resumed";

    case "simulation/setSpeedMultiplier": {
      const m = state.simulation.timeState.speedMultiplier;
      return `Speed → ${m}×`;
    }

    case "simulation/cycleSimulationScale": {
      const name = state.simulation.simulationParameters.simulationScale.name;
      return `Scale → ${name}`;
    }

    case "simulation/toggleShowGrid":
      return state.simulation.simulationParameters.showGrid
        ? "Grid: on"
        : "Grid: off";

    case "simulation/toggleShowAxes":
      return state.simulation.simulationParameters.showAxes
        ? "Axes: on"
        : "Axes: off";

    case "simulation/toggleShowTrails":
      return state.simulation.simulationParameters.showTrails
        ? "Trails: on"
        : "Trails: off";

    case "simulation/toggleShowPlanetInfoOverlay":
      return state.simulation.simulationParameters.showPlanetInfoOverlay
        ? "Labels: on"
        : "Labels: off";

    case "simulation/setActiveBody": {
      const name = state.simulation.activeBodyState.activeBodyName ?? "—";
      return `Now tracking · ${name}`;
    }

    case "simulation/setLastSimRequest": {
      const req = state.simulation.simulationParameters.lastRequest;
      if (!req) return null;
      return `Sim init · ${req.celestialBodyNames.length} bodies, ${req.integrator.toUpperCase()}, ${req.frame}`;
    }

    default:
      return null;
  }
}
