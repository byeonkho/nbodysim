// Launch a precomputed preset clip from the static edge asset instead of the
// live backend. No /initialize, no /chunk, no session: the manifest is applied
// through the same loadSimulation reducer the live path uses, the bundled
// chunks are decoded through the same worker and appended to the buffer, and
// the null session means the prefetch middleware never fires. The clip is
// self-contained; reaching its end just freezes on the last frame
// (computeNextIndex clamps to totalTimesteps - 1). Returns false if the preset
// is unknown, the clip is too large for this client's buffer budget, or the
// asset is unreachable or corrupt, so the caller can fall back to a live run.
import type { AppDispatch } from "@/app/store/Store";
import {
  appendChunkToBuffer,
  loadSimulation,
  setIsPaused,
  setLastSimRequest,
} from "@/app/store/slices/SimulationSlice";
import { decodeOffMainThread } from "@/app/store/middleware/simulationRequestThunk";
import {
  clipUrl,
  parsePresetClipBundle,
  type ParsedPresetClipBundle,
} from "@/app/utils/presetClipBundle";
import {
  CLIP_PRESETS,
  CLIP_SAMPLES_PER_CHUNK,
  type ClipPreset,
} from "@/app/constants/ClipPresets";
import { clipFitsClientBudget } from "@/app/store/chunkBuffer";

export async function runStaticClip(
  dispatch: AppDispatch,
  presetId: ClipPreset["id"],
): Promise<boolean> {
  // Unknown preset, or a clip too large for this client's buffer budget:
  // report "no clip" so every caller falls back to the live streaming path.
  const preset = CLIP_PRESETS.find((p) => p.id === presetId);
  if (!preset) return false;
  if (
    !clipFitsClientBudget(
      preset.keys.length,
      preset.chunkCount,
      CLIP_SAMPLES_PER_CHUNK,
    )
  ) {
    return false;
  }

  let bytes: Uint8Array;
  try {
    const res = await fetch(clipUrl(presetId));
    if (!res.ok) return false;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return false;
  }

  // A truncated or garbled asset throws here (bad JSON / out-of-range reads).
  // Nothing has been dispatched yet, so "no clip" is still a clean answer.
  let manifest: ParsedPresetClipBundle["manifest"];
  let chunks: ParsedPresetClipBundle["chunks"];
  try {
    ({ manifest, chunks } = parsePresetClipBundle(bytes));
  } catch {
    return false;
  }

  // simulationMetaData: null => no session => no chunk prefetch ever.
  dispatch(
    loadSimulation({
      celestialBodyPropertiesList: manifest.celestialBodyPropertiesList,
      simulationMetaData: null,
    }),
  );

  // Parity with the live launch path so status readouts have real values.
  dispatch(
    setLastSimRequest({
      celestialBodyNames: manifest.params.bodies,
      date: manifest.params.epoch,
      frame: manifest.params.frame,
      integrator: manifest.params.integrator,
      timeStepUnit: manifest.params.timeStepUnit,
      fidelityBucket: manifest.params.fidelityBucket,
    }),
  );

  // Decode + append in order. Each chunk needs its own ArrayBuffer because the
  // worker transfers (neuters) the buffer it is handed; slice() copies into a
  // fresh, exactly-sized buffer.
  try {
    for (const chunk of chunks) {
      const payload = await decodeOffMainThread(chunk.slice().buffer);
      dispatch(
        appendChunkToBuffer({
          bodyNames: payload.bodyNames,
          bodyCount: payload.bodyCount,
          timestepCount: payload.timestepCount,
          positions: payload.positions,
          timestamps: payload.timestamps,
          mu: payload.mu,
          deltaERelative: payload.deltaERelative,
          dp853AvgStepSeconds: payload.dp853AvgStepSeconds,
          dp853AcceptRate: payload.dp853AcceptRate,
        }),
      );
    }
  } catch {
    // A mid-loop decode failure leaves earlier chunks in the buffer (still
    // paused, so nothing plays). Recovery relies on the caller's live
    // fallback: its loadSimulation dispatch rebuilds the buffer from scratch.
    return false;
  }

  dispatch(setIsPaused(false));
  return true;
}
