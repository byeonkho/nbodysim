/// <reference lib="webworker" />

// Web Worker for zstd decompression + binary deserialization.
// Off-loads decompression and binary-to-object decoding from the main thread.
// The ArrayBuffer is transferred from the main thread via postMessage's
// transferable list — zero-copy.
//
// Wire format after zstd (matches BinaryResponseSerializer.java, all little-endian):
//   uint16   bodyCount
//   per body: uint16 nameLength, UTF-8 name bytes
//   uint32   timestepCount
//   per timestep:
//     int64    timestamp (millis since UNIX epoch, UTC)
//     per body (header order):
//       float64 × 6   (px, py, pz, vx, vy, vz)

import { ZSTDDecoder } from "zstddec";

interface DecodeRequest {
  id: number;
  buffer: ArrayBuffer;
}

interface DecodeSuccess {
  id: number;
  payload: unknown;
}

interface DecodeError {
  id: number;
  error: string;
}

export type DecodeResponse = DecodeSuccess | DecodeError;

// Eagerly start WASM init the moment the worker boots so the first message
// rarely pays the load cost.
const decoderPromise: Promise<ZSTDDecoder> = (async () => {
  const d = new ZSTDDecoder();
  await d.init();
  return d;
})();

const utf8Decoder = new TextDecoder("utf-8");

interface CelestialBody {
  name: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

function parseBinary(bytes: Uint8Array): Record<string, CelestialBody[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const bodyCount = view.getUint16(offset, true);
  offset += 2;

  const names: string[] = new Array(bodyCount);
  for (let i = 0; i < bodyCount; i++) {
    const nameLen = view.getUint16(offset, true);
    offset += 2;
    const nameBytes = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset + offset,
      nameLen,
    );
    names[i] = utf8Decoder.decode(nameBytes);
    offset += nameLen;
  }

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const data: Record<string, CelestialBody[]> = {};
  for (let t = 0; t < timestepCount; t++) {
    const millis = Number(view.getBigInt64(offset, true));
    offset += 8;
    const isoKey = new Date(millis).toISOString();

    const snapshot: CelestialBody[] = new Array(bodyCount);
    for (let b = 0; b < bodyCount; b++) {
      const px = view.getFloat64(offset, true); offset += 8;
      const py = view.getFloat64(offset, true); offset += 8;
      const pz = view.getFloat64(offset, true); offset += 8;
      const vx = view.getFloat64(offset, true); offset += 8;
      const vy = view.getFloat64(offset, true); offset += 8;
      const vz = view.getFloat64(offset, true); offset += 8;
      snapshot[b] = {
        name: names[b],
        position: { x: px, y: py, z: pz },
        velocity: { x: vx, y: vy, z: vz },
      };
    }
    data[isoKey] = snapshot;
  }

  return data;
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, buffer } = event.data;
  try {
    const decoder = await decoderPromise;
    const view = new DataView(buffer);
    const uncompressedSize = view.getUint32(0, true);
    const compressed = new Uint8Array(buffer, 4);

    const t0 = performance.now();
    const decompressed = decoder.decode(compressed, uncompressedSize);
    const t1 = performance.now();
    const data = parseBinary(decompressed);
    const t2 = performance.now();
    console.log(
      `[zstd worker] zstd=${(t1 - t0) | 0}ms binary=${(t2 - t1) | 0}ms total=${(t2 - t0) | 0}ms (${(uncompressedSize / 1024) | 0}KB)`,
    );

    const payload = { messageType: "SIM_DATA", data };
    const response: DecodeSuccess = { id, payload };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: DecodeError = { id, error: message };
    self.postMessage(response);
  }
};
