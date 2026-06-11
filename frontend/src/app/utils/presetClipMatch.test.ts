import { describe, it, expect } from "vitest";
import { matchPresetClip } from "./presetClipMatch";
import {
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "./runSimulation";
import { DEFAULT_FRAME, type TimeUnit } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import { CLIP_PRESETS, DEFAULT_CLIP_ID } from "@/app/constants/ClipPresets";
import type { BodyKey } from "@/app/constants/BodyVisuals";

const DEFAULT_BUCKET = INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow";
const defaultClip = CLIP_PRESETS.find((p) => p.id === DEFAULT_CLIP_ID)!;

function input(overrides: Partial<Parameters<typeof matchPresetClip>[0]> = {}) {
  return {
    bodyKeys: new Set<BodyKey>(defaultClip.keys),
    epoch: PRESET_EPOCH,
    frame: DEFAULT_FRAME,
    integrator: PRESET_INTEGRATOR,
    timeStepUnit: PRESET_TIME_UNIT,
    fidelityBucket: DEFAULT_BUCKET,
    ...overrides,
  };
}

describe("matchPresetClip", () => {
  it("matches each of the five presets by exact body set", () => {
    for (const preset of CLIP_PRESETS) {
      expect(
        matchPresetClip(input({ bodyKeys: new Set<BodyKey>(preset.keys) })),
      ).toBe(preset.id);
    }
  });

  it("is order-insensitive over the body selection", () => {
    const reversed = new Set<BodyKey>([...defaultClip.keys].reverse());
    expect(matchPresetClip(input({ bodyKeys: reversed }))).toBe(DEFAULT_CLIP_ID);
  });

  it("rejects any drift from the canonical scenario", () => {
    const withExtra = new Set<BodyKey>([...defaultClip.keys, "PLUTO"]);
    // A proper subset of the default keys: catches an implementation that
    // checks only one containment direction instead of set equality.
    const missingOne = new Set<BodyKey>([...defaultClip.keys].slice(1));
    expect(matchPresetClip(input({ bodyKeys: withExtra }))).toBeNull();
    expect(matchPresetClip(input({ bodyKeys: missingOne }))).toBeNull();
    expect(
      matchPresetClip(input({ epoch: "2025-01-01T00:00:00.000" })),
    ).toBeNull();
    expect(matchPresetClip(input({ integrator: "dp853" }))).toBeNull();
    expect(matchPresetClip(input({ frame: "NotARealFrame" }))).toBeNull();
    expect(
      matchPresetClip(input({ timeStepUnit: "Days" as TimeUnit })),
    ).toBeNull();
    expect(matchPresetClip(input({ fidelityBucket: "medium" }))).toBeNull();
  });
});
