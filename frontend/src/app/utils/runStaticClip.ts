import type { AppDispatch } from "@/app/store/Store";
import {
  appendChunkToBuffer,
  loadSimulation,
  setIsPaused,
  setLastSimRequest,
} from "@/app/store/slices/SimulationSlice";
import { decodeOffMainThread } from "@/app/store/middleware/simulationRequestThunk";
import { parseDefaultSimBundle } from "@/app/utils/defaultSimBundle";

const BUNDLE_URL = "/default-sim-v3.bin";

// Launch the precomputed default solar-system clip from the static edge asset
// instead of the live backend. No /initialize, no /chunk, no session: the
// manifest is applied through the same loadSimulation reducer the live path
// uses, the bundled chunks are decoded through the same worker and appended to
// the buffer, and the null session means the prefetch middleware never fires.
// The clip is self-contained; reaching its end just freezes on the last frame
// (computeNextIndex clamps to totalTimesteps - 1). Returns false if the asset
// is unreachable so the caller can fall back to a live run.
export async function runStaticClip(dispatch: AppDispatch): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    const res = await fetch(BUNDLE_URL);
    if (!res.ok) return false;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return false;
  }

  const { manifest, chunks } = parseDefaultSimBundle(bytes);

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

  dispatch(setIsPaused(false));
  return true;
}
