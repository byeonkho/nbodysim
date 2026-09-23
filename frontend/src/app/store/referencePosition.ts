import { Vector3 } from "three";
import { readBodyPositionInto, type ChunkBuffer } from "./chunkBuffer";
import type { GroundTruthAnchorLike } from "./trueTrack";

type BodyProperties = {
  name?: string;
  mu?: number;
  referenceBodyNames?: string[];
};
type Group = { indices: number[]; weights: number[]; scratch: Vector3 };
// Prepared once per session/properties/active body. Frame work is O(group size),
// at most parent plus four Galileans, independent of buffered history.
const groups = new WeakMap<
  Float64Array,
  WeakMap<BodyProperties[], Map<string, Group>>
>();

export function readReferencePositionInto(
  out: Vector3,
  buffer: ChunkBuffer,
  idx: number,
  body: string,
  properties: BodyProperties[],
): boolean {
  let byProperties = groups.get(buffer.positions);
  if (!byProperties)
    groups.set(buffer.positions, (byProperties = new WeakMap()));
  let byBody = byProperties.get(properties);
  if (!byBody) byProperties.set(properties, (byBody = new Map()));
  let group = byBody.get(body);
  if (!group) {
    const prop = properties.find(
      (p) => p.name?.toUpperCase() === body.toUpperCase(),
    );
    const names = prop?.referenceBodyNames ?? [body];
    const indices: number[] = [];
    const mus: number[] = [];
    for (const name of names) {
      const index = buffer.bodyNames.findIndex(
        (n) => n.toUpperCase() === name.toUpperCase(),
      );
      if (index < 0) return false;
      indices.push(index);
      mus.push(
        properties.find((p) => p.name?.toUpperCase() === name.toUpperCase())
          ?.mu ?? 0,
      );
    }
    const sum = mus.reduce((a, b) => a + b, 0);
    if (names.length > 1 && sum <= 0) return false;
    group = {
      indices,
      weights: mus.map((mu) => (sum > 0 ? mu / sum : 1)),
      scratch: new Vector3(),
    };
    byBody.set(body, group);
  }
  readBodyPositionInto(out, buffer, idx, group.indices[0]);
  const x = out.x,
    y = out.y,
    z = out.z;
  for (let i = 1; i < group.indices.length; i++) {
    readBodyPositionInto(group.scratch, buffer, idx, group.indices[i]);
    out.x += group.weights[i] * (group.scratch.x - x);
    out.y += group.weights[i] * (group.scratch.y - y);
    out.z += group.weights[i] * (group.scratch.z - z);
  }
  return true;
}

/** Numeric measurements require a sample at exactly the saved timestamp.
 * Binary search is O(log 2000), with no allocation; never interpolate or clamp. */
export function readExactReferenceInto(
  out: Vector3,
  anchors: GroundTruthAnchorLike[] | undefined,
  epoch: number,
): boolean {
  if (!anchors) return false;
  let lo = 0,
    hi = anchors.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const a = anchors[mid];
    const key = a.referenceEpoch ?? a.epochMillis;
    if (key === epoch) {
      out.set(a.position[0], a.position[1], a.position[2]);
      return true;
    }
    if (key < epoch) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}
