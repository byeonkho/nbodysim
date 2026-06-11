// Parser for a precomputed preset clip: a static asset that packs one preset
// scenario's /initialize response plus its first few /chunk payloads into one
// file, so canonical scenarios play from the edge with zero backend calls.
// Envelope (all little-endian):
//   uint32 manifestLength
//   manifest JSON (UTF-8): { params, celestialBodyPropertiesList }
//   repeated: uint32 chunkLength, chunk bytes (untouched zstd-compressed v3 payload)
// The Java writer is PresetClipAssetGeneratorTest; the staleness guard pins the
// two together.

import type { components } from "@/app/generated/api";

export type CelestialBodyWire = components["schemas"]["CelestialBodyWrapper"];

export interface PresetClipParams {
  formatVersion: number;
  presetId: string;
  epoch: string;
  integrator: string;
  frame: string;
  timeStepUnit: string;
  fidelityBucket: string;
  bodies: string[];
  chunkCount: number;
}

export interface PresetClipManifest {
  params: PresetClipParams;
  // The captured /initialize body list, applied through loadSimulation exactly
  // as the live path applies the initialize response.
  celestialBodyPropertiesList: CelestialBodyWire[];
}

export interface ParsedPresetClipBundle {
  manifest: PresetClipManifest;
  // Each entry is one zstd-compressed v3 chunk payload, decoded later via the
  // same worker the live chunk path uses.
  chunks: Uint8Array[];
}

// Format version in the filename so a wire-format bump busts the edge cache.
export function clipUrl(presetId: string): string {
  return `/clip-${presetId}-v3.bin`;
}

const utf8Decoder = new TextDecoder("utf-8");

export function parsePresetClipBundle(
  bytes: Uint8Array,
): ParsedPresetClipBundle {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const manifestLen = view.getUint32(offset, true);
  offset += 4;
  const manifestBytes = bytes.subarray(offset, offset + manifestLen);
  const manifest = JSON.parse(
    utf8Decoder.decode(manifestBytes),
  ) as PresetClipManifest;
  offset += manifestLen;

  const chunks: Uint8Array[] = [];
  while (offset < bytes.length) {
    const chunkLen = view.getUint32(offset, true);
    offset += 4;
    chunks.push(bytes.subarray(offset, offset + chunkLen));
    offset += chunkLen;
  }

  return { manifest, chunks };
}
