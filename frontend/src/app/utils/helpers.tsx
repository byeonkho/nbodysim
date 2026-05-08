import { Vector3Simple } from "@/app/store/slices/SimulationSlice";
import MathConstants from "@/app/constants/MathConstants";

export const toTitleCase = (str: string): string => {
  return str.toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
};

export const calculateDistance = (
  vec1: Vector3Simple,
  vec2: Vector3Simple,
  unit: string,
): string => {
  const dx = vec2.x - vec1.x;
  const dy = vec2.y - vec1.y;
  const dz = vec2.z - vec1.z;

  const result = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (unit === "KM") {
    const km: number = result / MathConstants.METRES_TO_KM;
    // Format km as an integer with locale-specific separators
    return Math.round(km).toLocaleString("en-US") + " km";
  } else if (unit === "AU") {
    const au: number = result / MathConstants.METRES_TO_AU;
    const roundedAU: number = Math.round(au * 100) / 100; // Rounded to two decimal places
    if (roundedAU === 0) {
      // Fallback: show km instead if AU is too small
      const km: number = result / MathConstants.METRES_TO_KM;
      return Math.round(km).toLocaleString("en-US") + " km";
    }
    // Format AU with two decimal places and locale-specific separators
    return (
      roundedAU.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " AU"
    );
  }
  // Fallback: if no valid unit is provided, return meters formatted with locale-specific separators.
  return result.toLocaleString("en-US") + " m";
};

// Mutating-output variant: writes (a - b) into `out` to avoid per-call
// allocation. Callers are hot-path useFrame consumers; the immutable
// version compounded across 9+ bodies per frame.
export const subtractInto = (
  out: Vector3Simple,
  a: Vector3Simple,
  b: Vector3Simple,
): void => {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
};

export const calculateMagnitude = (v: Vector3Simple): number => {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
};

export const formatToKM = (n: number): string => {
  const km = n / 1000;
  return (
    km.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " km/s"
  );
};

export const roundToTwoDecimals = (value: number): number => {
  return Math.round(value * 10) / 10;
};

// Mutating-output variant: writes the scaled position into `out`.
// `out = orbiting + (primary - orbiting) * scaleFactor`. Used to render
// non-1 positionScale bodies (e.g. Moon) at exaggerated parent-relative
// distance without losing rotational alignment with the parent.
export function scaleDistanceInto(
  out: Vector3Simple,
  primary: Vector3Simple,
  orbiting: Vector3Simple,
  scaleFactor: number,
): void {
  out.x = orbiting.x + (primary.x - orbiting.x) * scaleFactor;
  out.y = orbiting.y + (primary.y - orbiting.y) * scaleFactor;
  out.z = orbiting.z + (primary.z - orbiting.z) * scaleFactor;
}
