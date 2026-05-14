import type { ChunkBuffer } from "@/app/store/chunkBuffer";
import type {
  DisplayFrame,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";
import { readBodyPositionInto } from "@/app/store/chunkBuffer";
import * as THREE from "three";

// Render-time frame transform. Backend always emits Sun-relative snapshots
// (Simulation.snapshotFromState shifts by the Sun's state), so the
// "displayed in heliocentric" view is the raw input. Other display frames
// are produced by subtracting a per-snapshot pivot point from every body's
// position before rendering.
//
//   helio: pivot = (0, 0, 0)        (Sun at origin — the wire format default)
//   geo:   pivot = Earth's position (Earth pinned at origin; Sun traces
//          Earth's orbit mirrored, Mars exhibits retrograde loop motion)
//
// Barycentric is intentionally omitted — see the DisplayFrame type comment
// in SimulationSlice for the deferral rationale.
//
// All operations write into a caller-provided Vector3Simple to avoid
// allocations on the trail-rendering hot path.

const EARTH_NAME_UPPER = "EARTH";

/**
 * Resolve Earth's body index from the buffer's name map. Case-insensitive
 * match since backend may emit "Earth" or "earth". Returns -1 if Earth isn't
 * in the body list — callers should fall back to helio (zero pivot).
 */
export function findEarthBodyIndex(buffer: ChunkBuffer): number {
  for (const [name, idx] of buffer.bodyNameToIndex.entries()) {
    if (name.trim().toUpperCase() === EARTH_NAME_UPPER) return idx;
  }
  return -1;
}

// Module-level scratch reused inside writePivotInto so callers don't pass
// one. Safe because the render loop is single-threaded.
const pivotVec = new THREE.Vector3();

/**
 * Write the pivot vector for the given (timestep, frame) into `out`.
 * Helio → zero pivot. Geo → Earth's position at this timestep. Out-of-range
 * or missing-Earth → zero pivot fallback.
 */
export function writePivotInto(
  out: Vector3Simple,
  buffer: ChunkBuffer | null,
  timestepIdx: number,
  frame: DisplayFrame,
): void {
  if (
    frame === "helio" ||
    !buffer ||
    timestepIdx < 0 ||
    timestepIdx >= buffer.totalTimesteps
  ) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  const earthIdx = findEarthBodyIndex(buffer);
  if (earthIdx < 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  readBodyPositionInto(pivotVec, buffer, timestepIdx, earthIdx);
  out.x = pivotVec.x;
  out.y = pivotVec.y;
  out.z = pivotVec.z;
}
