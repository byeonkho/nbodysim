// Astronomical date math used by the top strip + scrubber.
//
// JD: Julian Date — continuous count of days since noon UTC on
//   Jan 1, 4713 BC (proleptic Julian calendar). Standard astrodynamics
//   timestamp; the design's top strip surfaces it next to UTC.
// J2000 epoch: JD 2451545.0 = Jan 1 2000 12:00:00 TT (≈ UTC + 32.184s).
//   For visualization purposes we treat as Jan 1 2000 12:00 UTC; the
//   sub-minute TT offset is invisible on a "T+8929 d" readout.

const J2000_UTC_MS = Date.UTC(2000, 0, 1, 12, 0, 0); // Jan 1 2000 12:00 UTC
const MS_PER_DAY = 86_400_000;
const UNIX_TO_JD_DAYS = 2440587.5; // Jan 1 1970 00:00 UTC = JD 2440587.5

export function isoToDateOrNull(iso: string): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

export function julianDate(d: Date): number {
  return UNIX_TO_JD_DAYS + d.getTime() / MS_PER_DAY;
}

export function daysSinceJ2000(d: Date): number {
  return (d.getTime() - J2000_UTC_MS) / MS_PER_DAY;
}

// Pretty-print JD with thin-space thousand separators and a 5-digit
// fractional component to match the design ("2 460 478.79167").
export function formatJD(jd: number): string {
  if (!Number.isFinite(jd)) return "—";
  const wholePart = Math.floor(jd);
  const frac = jd - wholePart;
  const wholeStr = wholePart
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " "); // thin space
  return `${wholeStr}.${frac.toFixed(5).slice(2)}`;
}

// "T+8 929 d" — signed days since J2000 with thin-space grouping.
export function formatTPlus(d: Date): string {
  const days = daysSinceJ2000(d);
  const sign = days >= 0 ? "+" : "−";
  const abs = Math.floor(Math.abs(days));
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `T${sign}${grouped} d`;
}

const SECS_PER_UNIT: Record<string, number> = {
  Seconds: 1,
  Hours: 3_600,
  Days: 86_400,
  Weeks: 604_800,
};

export function timeStepSeconds(unit: string | undefined): number {
  if (!unit) return 3600;
  return SECS_PER_UNIT[unit] ?? 3600;
}

// "3600 s" / "86 400 s" — Δt formatted like the design's status strip.
export function formatTimeStep(unit: string | undefined): string {
  const seconds = timeStepSeconds(unit);
  const grouped = seconds
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} s`;
}
