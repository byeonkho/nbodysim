// Speed multiplier readout: 2 decimals below 10x, 1 decimal at 10-99x,
// integers at 100x and up. Shared by the desktop Timeline and the mobile
// transport bar.
export function formatSpeed(speed: number): string {
  if (!Number.isFinite(speed)) return "0.00";
  const abs = Math.abs(speed);
  if (abs >= 100) return Math.round(speed).toString();
  if (abs >= 10) return speed.toFixed(1);
  return speed.toFixed(2);
}
