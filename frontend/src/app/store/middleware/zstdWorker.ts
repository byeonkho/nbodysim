/// <reference lib="webworker" />

// Web Worker for zstd decompression + binary deserialization.
// Off-loads decompression and binary-to-object decoding from the main thread.
// The ArrayBuffer is transferred from the main thread via postMessage's
// transferable list — zero-copy. The actual binary parsing lives in
// parseBinaryChunk.ts so it's testable without dragging in the WASM module.

import { ZSTDDecoder } from "zstddec";
import { parseBinaryChunk } from "./parseBinaryChunk";

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
    const parsed = parseBinaryChunk(decompressed);
    const t2 = performance.now();
    console.log(
      `[zstd worker] zstd=${(t1 - t0) | 0}ms binary=${(t2 - t1) | 0}ms total=${(t2 - t0) | 0}ms (${(uncompressedSize / 1024) | 0}KB)`,
    );

    const payload = {
      messageType: "SIM_DATA",
      data: parsed.data,
      mu: parsed.mu,
    };
    const response: DecodeSuccess = { id, payload };
    self.postMessage(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const response: DecodeError = { id, error: message };
    self.postMessage(response);
  }
};
