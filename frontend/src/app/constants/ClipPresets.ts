import { DEFAULT_SELECTED, PRESETS as CATALOG_PRESETS } from "@/app/constants/BodyCatalog";
import type { BodyKey } from "@/app/constants/BodyVisuals";

export interface ClipPreset {
  id: string;
  keys: readonly BodyKey[];
  // Chunks captured in this preset's clip asset. 6 (~6.8 sim-years) except
  // the 40-body full catalog, which ships 4 (~4.6 sim-years) so its decoded
  // buffer stays well inside the 12 MB lowMem client budget.
  chunkCount: number;
}

// Kept samples per clip chunk: 10k integrator steps thinned 1-in-10 by the
// presets' MED_LOW fidelity bucket. Lets a clip's decoded size be estimated
// before fetching it.
export const CLIP_SAMPLES_PER_CHUNK = 1_000;

// The builders' untouched body selection (Sun + 8 planets + Moon): what the
// mobile auto-run plays, and what an untouched Run in either builder
// intercepts to.
export const DEFAULT_CLIP_ID = "default";

const DEFAULT_CHUNK_COUNT = 6;
const FULL_CATALOG_CHUNK_COUNT = 4;

// Single registry of every canonical scenario with a precomputed clip: the
// default selection plus the four catalog quick-selects. The backend
// generator's preset table mirrors this list and the staleness guard pins
// the two together.
export const CLIP_PRESETS: ClipPreset[] = [
  {
    id: DEFAULT_CLIP_ID,
    keys: DEFAULT_SELECTED,
    chunkCount: DEFAULT_CHUNK_COUNT,
  },
  ...CATALOG_PRESETS.map((p) => ({
    id: p.id,
    keys: p.keys,
    chunkCount: p.id === "full" ? FULL_CATALOG_CHUNK_COUNT : DEFAULT_CHUNK_COUNT,
  })),
];
