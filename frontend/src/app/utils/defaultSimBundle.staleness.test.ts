import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDefaultSimBundle } from "./defaultSimBundle";
import { WIRE_FORMAT_VERSION } from "@/app/store/middleware/parseBinaryChunk";
import {
  PRESET_EPOCH,
  PRESET_INTEGRATOR,
  PRESET_TIME_UNIT,
} from "./runPreset";
import { DEFAULT_FRAME } from "@/app/constants/SimParams";
import { INTEGRATOR_DEFAULT_BUCKETS } from "@/app/constants/PlaybackQuality";
import { DEFAULT_SELECTED } from "@/app/constants/BodyCatalog";
import { BODY_DISPLAY } from "@/app/constants/BodyVisuals";

// Vitest runs with cwd = frontend/, so this resolves to frontend/public/...
const ASSET = "public/default-sim-v3.bin";
const REGEN =
  "cd backend && ./mvnw test -Dtest=DefaultSimAssetGeneratorTest -Ddefaultsim.write=true";

describe("default-sim bundle staleness guard", () => {
  it("committed asset's params match the default preset and wire version", () => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(ASSET));
    } catch {
      throw new Error(`Missing ${ASSET}. Regenerate: ${REGEN}`);
    }

    const { manifest, chunks } = parseDefaultSimBundle(bytes);
    const p = manifest.params;

    const expectedBodies = [...DEFAULT_SELECTED]
      .map((k) => BODY_DISPLAY[k])
      .sort();
    const expectedBucket = INTEGRATOR_DEFAULT_BUCKETS[PRESET_INTEGRATOR] ?? "medLow";
    const drift = `default-sim asset is stale. Regenerate: ${REGEN}`;

    expect(p.formatVersion, drift).toBe(WIRE_FORMAT_VERSION);
    expect(p.epoch, drift).toBe(PRESET_EPOCH);
    expect(p.integrator, drift).toBe(PRESET_INTEGRATOR);
    expect(p.frame, drift).toBe(DEFAULT_FRAME);
    expect(p.timeStepUnit, drift).toBe(PRESET_TIME_UNIT);
    expect(p.fidelityBucket, drift).toBe(expectedBucket);
    expect([...p.bodies].sort(), drift).toEqual(expectedBodies);

    // The captured body list must actually be populated, not just the params.
    // A correct-params-but-empty-body-list capture would ship a broken default
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
