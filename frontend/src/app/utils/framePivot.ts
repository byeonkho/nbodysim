import type {
  CelestialBody,
  DisplayFrame,
  Vector3Simple,
} from "@/app/store/slices/SimulationSlice";

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
// allocations on the trail-rendering hot path (called per history point
// per trail per frame).

const EARTH_NAME = "EARTH";

/**
 * Resolve the index of Earth in a snapshot. Used once per Trail / Sphere
 * to cache the index ref; subsequent frames look up snapshot[earthIdx]
 * directly. Returns -1 if Earth isn't in the body list — callers should
 * fall back to helio-equivalent (zero pivot) in that case.
 */
export function findEarthIndex(snapshot: CelestialBody[]): number {
  for (let i = 0; i < snapshot.length; i++) {
    if (snapshot[i].name.trim().toUpperCase() === EARTH_NAME) {
      return i;
    }
  }
  return -1;
}

/**
 * Write the pivot vector for a given frame into `out`. `earthIdx` is the
 * pre-resolved Earth index for geo mode; ignored for helio. Caller must
 * pass a valid index for non-helio frames or accept the helio fallback.
 */
export function writePivotInto(
  out: Vector3Simple,
  snapshot: CelestialBody[],
  frame: DisplayFrame,
  earthIdx: number,
): void {
  if (frame === "geo" && earthIdx >= 0 && earthIdx < snapshot.length) {
    const earth = snapshot[earthIdx];
    out.x = earth.position.x;
    out.y = earth.position.y;
    out.z = earth.position.z;
    return;
  }
  // Heliocentric or fallback: zero pivot (no shift).
  out.x = 0;
  out.y = 0;
  out.z = 0;
}
