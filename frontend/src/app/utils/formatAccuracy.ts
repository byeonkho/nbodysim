// Plain-English "accuracy" readout for the mobile body sheet. Takes the
// relative energy residual (ΔE/E₀, dimensionless) and renders it as a tiny
// percentage drift. The lone dash is the allowed no-data placeholder.
export function formatAccuracy(relativeEnergyResidual: number): string {
  if (!Number.isFinite(relativeEnergyResidual)) return "—";
  const pct = Math.abs(relativeEnergyResidual) * 100;
  const formatted = pct.toFixed(4);
  if (formatted === "0.0000") return "<0.0001%";
  return `${formatted}%`;
}
