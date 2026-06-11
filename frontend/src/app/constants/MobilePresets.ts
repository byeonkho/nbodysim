import type { BodyKey } from "@/app/constants/BodyVisuals";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";

export interface MobilePreset {
  id: "full-system" | "inner-planets" | "earth-moon";
  label: string;
  keys: BodyKey[];
}

// The three guided-explorer scenarios. Body sets only; epoch, frame,
// integrator, timestep, and fidelity are fixed in runPreset.ts.
export const MOBILE_PRESETS: MobilePreset[] = [
  { id: "full-system", label: "Full system", keys: [...DEFAULT_SELECTED] },
  {
    id: "inner-planets",
    label: "Inner planets",
    keys: ["SUN", "MERCURY", "VENUS", "EARTH", "MARS"],
  },
  { id: "earth-moon", label: "Earth and Moon", keys: ["SUN", "EARTH", "MOON"] },
];

export const DEFAULT_PRESET_ID: MobilePreset["id"] = "full-system";
