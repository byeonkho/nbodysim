import {
  BODY_CATEGORY,
  BODY_ORDER,
  type BodyCategory,
  type BodyKey,
} from "@/app/constants/BodyVisuals";

// Presentation grouping for the Sim Setup modal + body strip. This is a
// *display* grouping chosen for scannability; it stays distinct from the
// backend's BODY_CATEGORY (every moon is category "planet"; Charon's parent
// Pluto sits in the dwarf-planet section, so Charon counts there).

export const CATEGORY_ORDER: readonly BodyCategory[] = [
  "planet",
  "dwarfPlanet",
  "asteroid",
];

export const CATEGORY_LABEL: Record<BodyCategory, string> = {
  planet: "Planets",
  dwarfPlanet: "Dwarf planets",
  asteroid: "Near-Earth asteroids",
};

export const PLANET_KEYS: readonly BodyKey[] = [
  "SUN",
  "MERCURY",
  "VENUS",
  "EARTH",
  "MARS",
  "JUPITER",
  "SATURN",
  "URANUS",
  "NEPTUNE",
];

export const MOON_PARENT_ORDER = [
  "EARTH",
  "MARS",
  "JUPITER",
  "SATURN",
  "URANUS",
  "NEPTUNE",
  "PLUTO",
] as const;
export type MoonParent = (typeof MOON_PARENT_ORDER)[number];

export const MOON_PARENT_LABEL: Record<MoonParent, string> = {
  EARTH: "Earth",
  MARS: "Mars",
  JUPITER: "Jupiter",
  SATURN: "Saturn",
  URANUS: "Uranus",
  NEPTUNE: "Neptune",
  PLUTO: "Pluto",
};

export const MOON_PARENT_OF: Partial<Record<BodyKey, MoonParent>> = {
  MOON: "EARTH",
  PHOBOS: "MARS",
  DEIMOS: "MARS",
  IO: "JUPITER",
  EUROPA: "JUPITER",
  GANYMEDE: "JUPITER",
  CALLISTO: "JUPITER",
  MIMAS: "SATURN",
  ENCELADUS: "SATURN",
  TETHYS: "SATURN",
  DIONE: "SATURN",
  RHEA: "SATURN",
  TITAN: "SATURN",
  IAPETUS: "SATURN",
  ARIEL: "URANUS",
  UMBRIEL: "URANUS",
  TITANIA: "URANUS",
  OBERON: "URANUS",
  MIRANDA: "URANUS",
  TRITON: "NEPTUNE",
  NEREID: "NEPTUNE",
  CHARON: "PLUTO",
};

export const MOONS_BY_PARENT: Record<MoonParent, BodyKey[]> =
  MOON_PARENT_ORDER.reduce(
    (acc, p) => {
      acc[p] = [];
      return acc;
    },
    {} as Record<MoonParent, BodyKey[]>,
  );
for (const key of BODY_ORDER) {
  const p = MOON_PARENT_OF[key];
  if (p) MOONS_BY_PARENT[p].push(key);
}

export const ALL_MOONS: readonly BodyKey[] = MOON_PARENT_ORDER.flatMap(
  (p) => MOONS_BY_PARENT[p],
);

const MOON_PARENT_SET = new Set<string>(MOON_PARENT_ORDER);
export const isMoonParent = (key: BodyKey): key is MoonParent =>
  MOON_PARENT_SET.has(key);

// Top-level (non-moon) bodies per category, in catalog order.
export const TOP_LEVEL_BY_CATEGORY: Record<BodyCategory, BodyKey[]> = {
  planet: [],
  dwarfPlanet: [],
  asteroid: [],
};
for (const key of BODY_ORDER) {
  if (!MOON_PARENT_OF[key]) TOP_LEVEL_BY_CATEGORY[BODY_CATEGORY[key]].push(key);
}

// What a section "owns" for its master toggle + count: each top-level body
// plus the moons nested under it (so Charon counts under dwarfPlanet via Pluto).
export const SECTION_MEMBERS: Record<BodyCategory, BodyKey[]> = {
  planet: [],
  dwarfPlanet: [],
  asteroid: [],
};
for (const category of CATEGORY_ORDER) {
  for (const body of TOP_LEVEL_BY_CATEGORY[category]) {
    SECTION_MEMBERS[category].push(body);
    if (isMoonParent(body)) {
      SECTION_MEMBERS[category].push(...MOONS_BY_PARENT[body]);
    }
  }
}

// Default first-paint selection: Sun + 8 planets + Earth's Moon.
export const DEFAULT_SELECTED: BodyKey[] = [...PLANET_KEYS, "MOON"];

export interface Preset {
  id: string;
  label: string;
  keys: BodyKey[];
}

export const PRESETS: Preset[] = [
  {
    id: "inner",
    label: "Inner system",
    keys: ["SUN", "MERCURY", "VENUS", "EARTH", "MOON", "MARS", "PHOBOS", "DEIMOS"],
  },
  {
    id: "giants",
    label: "Gas giants + moons",
    keys: [
      "SUN",
      "JUPITER",
      "IO",
      "EUROPA",
      "GANYMEDE",
      "CALLISTO",
      "SATURN",
      "MIMAS",
      "ENCELADUS",
      "TETHYS",
      "DIONE",
      "RHEA",
      "TITAN",
      "IAPETUS",
      "URANUS",
      "ARIEL",
      "UMBRIEL",
      "TITANIA",
      "OBERON",
      "MIRANDA",
      "NEPTUNE",
      "TRITON",
      "NEREID",
    ],
  },
  {
    id: "neos",
    label: "NEOs only",
    keys: ["SUN", "EARTH", "EROS", "APOPHIS", "BENNU", "RYUGU"],
  },
  { id: "full", label: "Full system", keys: [...BODY_ORDER] },
];

export type ToggleState = "off" | "on" | "mixed";

// Master tri-state for a set of keys against the live selection.
export function masterState(
  keys: readonly BodyKey[],
  selected: Set<BodyKey>,
): ToggleState {
  if (keys.length === 0) return "off";
  const n = keys.filter((k) => selected.has(k)).length;
  return n === 0 ? "off" : n === keys.length ? "on" : "mixed";
}

// True iff the selection equals the preset's key set exactly (same size + members).
export function matchesPreset(preset: Preset, selected: Set<BodyKey>): boolean {
  if (preset.keys.length !== selected.size) return false;
  return preset.keys.every((k) => selected.has(k));
}
