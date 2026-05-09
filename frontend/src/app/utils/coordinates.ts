import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

// Backend snapshots arrive in ICRF (Orekit's "Heliocentric" frame is
// ICRF translated to the Sun) — Z is the celestial north pole, so the
// ecliptic plane sits roughly in the XY plane. Three.js conventionally
// treats the XZ plane as the horizontal floor (Y is up). Mapping ICRF
// → three.js axis-by-axis would render the orbital plane vertically,
// which is wrong for the design's top-down view.
//
// The fix: swap Y and Z. ICRF X → world X (left/right), ICRF Y → world
// Z (in-plane forward/back), ICRF Z → world Y (small vertical wobble
// from the 23.4° ecliptic tilt).
//
// All scene-positioning code MUST route through this helper. Inlining
// the swap risks one of the five call sites drifting silently —
// coordinates.test.ts pins the contract.

export interface VectorLike {
  set(x: number, y: number, z: number): unknown;
}

export function setBodyWorldPosition(
  target: VectorLike,
  body: Vector3Simple,
  scale: number,
): void {
  target.set(body.x / scale, body.z / scale, body.y / scale);
}

// Same swap, BufferGeometry-friendly: writes into a typed-array-like
// buffer at `offset`. Used by Trail.tsx where positions are mutated
// in place to avoid GPU-buffer reuploads.
//
// Kept in lockstep with setBodyWorldPosition above. Tests pin both;
// if you change one, change the other.
export function writeBodyWorldPositionToArray(
  out: { [i: number]: number },
  offset: number,
  body: Vector3Simple,
  scale: number,
): void {
  out[offset] = body.x / scale;
  out[offset + 1] = body.z / scale;
  out[offset + 2] = body.y / scale;
}
