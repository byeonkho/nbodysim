import { describe, it, expect } from "vitest";
import { parsePresetClipBundle } from "./presetClipBundle";

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("parsePresetClipBundle", () => {
  it("round-trips a manifest and its chunks", () => {
    const manifest = {
      params: {
        formatVersion: 3,
        presetId: "default",
        epoch: "2024-06-05T00:00:00.000",
        integrator: "rk4",
        frame: "Heliocentric",
        timeStepUnit: "Hours",
        fidelityBucket: "medLow",
        bodies: ["Earth", "Sun"],
        chunkCount: 2,
        samplesPerChunk: 1_000,
      },
      celestialBodyPropertiesList: [{ name: "Sun" }, { name: "Earth" }],
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const chunkA = new Uint8Array([1, 2, 3, 4, 5]);
    const chunkB = new Uint8Array([9, 8, 7]);

    const bundle = concat([
      u32le(manifestBytes.length),
      manifestBytes,
      u32le(chunkA.length),
      chunkA,
      u32le(chunkB.length),
      chunkB,
    ]);

    const parsed = parsePresetClipBundle(bundle);
    expect(parsed.manifest.params.integrator).toBe("rk4");
    expect(parsed.manifest.params.presetId).toBe("default");
    expect(parsed.manifest.params.chunkCount).toBe(2);
    expect(parsed.manifest.celestialBodyPropertiesList).toHaveLength(2);
    expect(parsed.chunks).toHaveLength(2);
    expect(Array.from(parsed.chunks[0])).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(parsed.chunks[1])).toEqual([9, 8, 7]);
  });
});
