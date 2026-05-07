// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format (after zstd, all little-endian):
//   uint16   bodyCount
//   per body: uint16 nameLength, UTF-8 name bytes
//   uint32   timestepCount
//   per timestep:
//     int64    timestamp (millis since UNIX epoch, UTC)
//     per body (header order):
//       float64 × 6   (px, py, pz, vx, vy, vz)

export interface CelestialBody {
  name: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
}

const utf8Decoder = new TextDecoder("utf-8");

export function parseBinaryChunk(
  bytes: Uint8Array,
): Record<string, CelestialBody[]> {
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
