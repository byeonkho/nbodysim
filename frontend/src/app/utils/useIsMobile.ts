"use client";

import { useSyncExternalStore } from "react";

// Below this width the app swaps to the mobile guided-explorer chrome.
// Width-only by design (see the mobile design spec); a coarse-pointer
// override is a possible later refinement, not v1.
export const MOBILE_MAX_WIDTH = 1280;

const QUERY = `(max-width: ${MOBILE_MAX_WIDTH - 1}px)`;

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// Server (and the first client render) reports desktop so SSR markup
// matches first paint; the canvas is identical either way, so the
// post-hydration swap to mobile chrome is seamless.
function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
