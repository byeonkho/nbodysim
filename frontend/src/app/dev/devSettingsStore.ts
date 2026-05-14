"use client";

import { useSyncExternalStore } from "react";

/**
 * Dev-only tunables exposed to the floating <DevToolbar />. Lives outside
 * Redux because (a) it's not part of the simulation domain model, (b) we
 * don't want it persisted to URL/serialised state, and (c) some consumers
 * read these values from event handlers (no Provider plumbing).
 *
 * Module-level state + useSyncExternalStore: components subscribe with
 * useDevSettings(), event handlers read with getDevSettings().
 */

export type SkyboxVariant = "full" | "milkyway" | "stars";

export interface DevSettings {
  /**
   * Multiplier on wheel deltaY for tracking-zoom updates.
   * Camera wheel handler: trackingZoomRef *= 1 + deltaY * zoomSensitivity.
   */
  zoomSensitivity: number;
  /** OrbitControls dampingFactor — smaller = more damping. */
  orbitDampingFactor: number;
  /**
   * Per-frame lerp factor used in body-tracking mode for the radial
   * (zoom) component of the camera position. Higher = snappier zoom
   * response. Decoupled from tangential smoothing so body transitions
   * stay buttery while zoom stays responsive.
   */
  cameraZoomLerpRate: number;
  /**
   * Number of trailing snapshot points each body's Trail renders.
   * Hard-capped at MAX_TRAIL_POINTS in Trail.tsx — buffer geometry is
   * allocated once at that size and the slider just changes how many
   * points get drawn, so dragging is allocation-free.
   */
  trailLength: number;
  /**
   * Active skybox texture. All three are pre-loaded by Skybox.tsx via
   * useTexture's object form, so switching is instant — no Suspense
   * flash during the swap.
   */
  skyboxVariant: SkyboxVariant;
}

const DEFAULTS: DevSettings = {
  zoomSensitivity: 0.001,
  orbitDampingFactor: 0.01,
  cameraZoomLerpRate: 0.1,
  trailLength: 1000,
  skyboxVariant: "full",
};

let state: DevSettings = { ...DEFAULTS };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): DevSettings => state;

/** Read current settings from outside React (event handlers, refs). */
export const getDevSettings = (): DevSettings => state;

/** Imperative setter — notifies all subscribed components. */
export const setDevSetting = <K extends keyof DevSettings>(
  key: K,
  value: DevSettings[K],
): void => {
  state = { ...state, [key]: value };
  listeners.forEach((l) => l());
};

/** React hook — subscribes to changes, no Provider required. */
export const useDevSettings = (): DevSettings =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
