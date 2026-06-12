import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { clipUrl, parsePresetClipBundle } from "./presetClipBundle";
import { WIRE_FORMAT_VERSION } from "@/app/store/middleware/parseBinaryChunk";
import {
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "./runSimulation";
import { DEFAULT_FRAME } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import {
  CLIP_PRESETS,
  CLIP_SAMPLES_PER_CHUNK,
} from "@/app/constants/ClipPresets";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";

const REGEN =
  "cd backend && ./mvnw test -Dtest=PresetClipAssetGeneratorTest -Dpresetclip.write=true";

describe("clip preset registry", () => {
  it("ids are unique", () => {
    const ids = CLIP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(CLIP_PRESETS)("preset clip staleness guard: $id", (preset) => {
  it("committed asset's params match the preset and wire version", () => {
    // Vitest runs with cwd = frontend/, so this resolves to frontend/public/...
    const asset = `public${clipUrl(preset.id)}`;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(asset));
    } catch {
      throw new Error(`Missing ${asset}. Regenerate: ${REGEN}`);
    }

    const { manifest, chunks } = parsePresetClipBundle(bytes);
    const p = manifest.params;

    const expectedBodies = preset.keys.map((k) => BODY_DISPLAY[k]).sort();
    const expectedBucket =
      INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow";
    const drift = `${preset.id} clip is stale. Regenerate: ${REGEN}`;

    expect(p.formatVersion, drift).toBe(WIRE_FORMAT_VERSION);
    expect(p.presetId, drift).toBe(preset.id);
    expect(p.epoch, drift).toBe(PRESET_EPOCH);
    expect(p.integrator, drift).toBe(PRESET_INTEGRATOR);
    expect(p.frame, drift).toBe(DEFAULT_FRAME);
    expect(p.timeStepUnit, drift).toBe(PRESET_TIME_UNIT);
    expect(p.fidelityBucket, drift).toBe(expectedBucket);
    expect(p.chunkCount, drift).toBe(preset.chunkCount);
    // The pre-fetch budget guard estimates decoded size from
    // CLIP_SAMPLES_PER_CHUNK, so a backend chunk-size or thinning change must
    // fail here rather than silently mis-size the client buffer.
    expect(p.samplesPerChunk, drift).toBe(CLIP_SAMPLES_PER_CHUNK);
    expect([...p.bodies].sort(), drift).toEqual(expectedBodies);

    // The captured body list must actually be populated, not just the params.
    // A correct-params-but-empty-body-list capture would ship a broken preset
    // with no other CI signal (a silent failure), so pin it to the body count.
    expect(manifest.celestialBodyPropertiesList.length, drift).toBe(
      p.bodies.length,
    );

    // Cross-language envelope pin: the TS parser must read every chunk the Java
    // generator wrote, and the count must match the manifest.
    expect(chunks.length, drift).toBe(p.chunkCount);
    expect(
      chunks.every((c) => c.length > 0),
      drift,
    ).toBe(true);
  });
});
