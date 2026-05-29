// Reference-frame options. The label is what the user sees AND what is stored
// in the request for display (ConfigurationChip / TopStatusStrip / event log
// render lastRequest.frame raw). Only the backend call converts label -> code;
// CustomFrameFactory accepts exactly heliocentric | icrf | gcrf (case-insensitive).
export const FRAME_OPTIONS = [
  { label: "Heliocentric", code: "heliocentric" },
  { label: "Solar-system barycenter", code: "icrf" },
  { label: "Geocentric", code: "gcrf" },
] as const;

export type FrameLabel = (typeof FRAME_OPTIONS)[number]["label"];

export const FRAME_CODE: Record<string, string> = Object.fromEntries(
  FRAME_OPTIONS.map((f) => [f.label, f.code]),
);

export const FRAME_LABELS: readonly string[] = FRAME_OPTIONS.map((f) => f.label);

export const DEFAULT_FRAME: FrameLabel = "Heliocentric";

// Integrator value/label pairs — value is the code sent to the backend,
// displayed uppercased elsewhere (matches today's drawer + ConfigurationChip).
export const INTEGRATORS = [
  ["euler", "Euler"],
  ["rk4", "RK4"],
  ["dp853", "DormandPrince853"],
] as const;

export const TIME_UNITS = ["Seconds", "Hours", "Days", "Weeks"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];
