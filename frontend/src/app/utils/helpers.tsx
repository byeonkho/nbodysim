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

// Scientific notation, 1 sig fig in the mantissa (e.g. "2.3e-12"). Used for
// the integrator-residual ΔE/E₀ readout — values span ~1e-3 (Euler) to
// ~1e-15 (DP853 at fresh start), so a fixed-format approach would either
// truncate small values to 0 or waste space on Euler.
export const formatDeltaE = (v: number): string => {
  if (v === 0 || !Number.isFinite(v)) return "0";
  const abs = Math.abs(v);
  const exp = Math.floor(Math.log10(abs));
  const mantissa = v / Math.pow(10, exp);
  const sign = exp >= 0 ? "+" : "";
  return `${mantissa.toFixed(1)}e${sign}${exp}`;
};

// Picks a unit (s / min / h / d) based on magnitude. Used for the DP853
// avg-step-size readout — values span ~60s (close encounters) to ~86400s
// (cruise). Single decimal place keeps the readout tight at all scales.
export const formatStepDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} d`;
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
