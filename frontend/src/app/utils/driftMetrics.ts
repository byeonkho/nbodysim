import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

export interface DriftMetrics {
  km: number;       // straight-line separation predicted↔truth
  angleDeg: number; // angular separation as seen from the frame origin (the Sun)
}

/**
 * Physical drift between the integrator's predicted position and the true
 * position, both Sun-relative metres in the session frame. Frame-independent
 * (a difference of two Sun-relative vectors), so it needs no pivot/scale.
 */
export function driftMetrics(
  predicted: Vector3Simple,
  truth: Vector3Simple,
): DriftMetrics {
  const dx = predicted.x - truth.x;
  const dy = predicted.y - truth.y;
  const dz = predicted.z - truth.z;
  const km = Math.sqrt(dx * dx + dy * dy + dz * dz) / 1000;

  const pMag = Math.hypot(predicted.x, predicted.y, predicted.z);
  const tMag = Math.hypot(truth.x, truth.y, truth.z);
  let angleDeg = 0;
  if (pMag > 0 && tMag > 0) {
    const dot = predicted.x * truth.x + predicted.y * truth.y + predicted.z * truth.z;
    // Clamp for floating-point safety before acos.
    const cos = Math.min(1, Math.max(-1, dot / (pMag * tMag)));
    angleDeg = (Math.acos(cos) * 180) / Math.PI;
  }
  return { km, angleDeg };
}
