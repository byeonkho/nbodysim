import { describe, expect, it } from "vitest";
import {
  createChunkBuffer,
  CHUNK_SIZE,
  computeBufferCapacity,
  selectBufferByteBudget,
  BUFFER_BYTE_BUDGETS,
  appendChunk,
  readBodyPositionInto,
  readBodyStateInto,
  readDeltaERelativeAt,
  getTimestamp,
  getTimestampAsIsoString,
  clipFitsClientBudget,
} from "./chunkBuffer";
import * as THREE from "three";

function makeChunkPositions(
  bodyCount: number,
  timestepCount: number,
  startValue = 0,
): Float64Array {
  const arr = new Float64Array(bodyCount * timestepCount * 6);
  for (let i = 0; i < arr.length; i++) arr[i] = startValue + i;
  return arr;
}

function makeChunkTimestamps(
  timestepCount: number,
  startMillis: bigint = BigInt(0),
): BigInt64Array {
  const arr = new BigInt64Array(timestepCount);
  for (let i = 0; i < timestepCount; i++) arr[i] = startMillis + BigInt(i);
  return arr;
}

describe("createChunkBuffer", () => {
  it("allocates positions and timestamps sized for the given capacity", () => {
    const buf = createChunkBuffer(["Earth", "Moon"], 1000);
    expect(buf.bodyCount).toBe(2);
    expect(buf.bodyNames).toEqual(["Earth", "Moon"]);
    expect(buf.bodyNameToIndex.get("Earth")).toBe(0);
    expect(buf.bodyNameToIndex.get("Moon")).toBe(1);
    expect(buf.positions.length).toBe(1000 * 2 * 6);
    expect(buf.timestamps.length).toBe(1000);
    expect(buf.totalTimesteps).toBe(0);
    expect(buf.bufferStartTimestep).toBe(0);
    expect(buf.capacity).toBe(1000);
  });

  it("exports CHUNK_SIZE", () => {
    expect(CHUNK_SIZE).toBe(10_000);
  });
});

describe("selectBufferByteBudget", () => {
  it("returns lowMem budget when viewport is narrow", () => {
    const fakeMatchMedia = (q: string) => ({
      matches: q.includes("max-width: 767px"),
    });
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: fakeMatchMedia as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns lowMem budget when deviceMemory ≤ 4", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 4 } as unknown as Navigator,
      matchMedia: (() => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.lowMem);
  });

  it("returns default budget when neither low-mem signal applies", () => {
    const budget = selectBufferByteBudget({
      navigator: { deviceMemory: 8 } as unknown as Navigator,
      matchMedia: (() => ({ matches: false })) as unknown as typeof window.matchMedia,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });

  it("returns default budget when navigator/matchMedia are absent (SSR)", () => {
    const budget = selectBufferByteBudget({
      navigator: undefined,
      matchMedia: undefined,
    });
    expect(budget).toBe(BUFFER_BYTE_BUDGETS.default);
  });
});

describe("computeBufferCapacity", () => {
  it("derives capacity from byte budget and body count", () => {
    // 12 MB / (9 bodies × 48 bytes) = 27,962 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.lowMem)).toBe(29_127);
    // 48 MB / (9 bodies × 48 bytes) = 116,508 floor
    expect(computeBufferCapacity(9, BUFFER_BYTE_BUDGETS.default)).toBe(116_508);
  });

  it("scales inversely with body count", () => {
    expect(computeBufferCapacity(3, BUFFER_BYTE_BUDGETS.default)).toBeGreaterThan(
      computeBufferCapacity(12, BUFFER_BYTE_BUDGETS.default),
    );
  });
});

describe("appendChunk", () => {
  it("appends to a fresh buffer without eviction", () => {
    const buf = createChunkBuffer(["A", "B"], 100);
    const positions = makeChunkPositions(2, 10);
    const timestamps = makeChunkTimestamps(10);
    appendChunk(buf, positions, timestamps, new Float32Array(10), 10);

    expect(buf.totalTimesteps).toBe(10);
    expect(buf.bufferStartTimestep).toBe(0);
    // First slot of first body
    expect(buf.positions[0]).toBe(0);
    // Last slot of last body of timestep 9
    expect(buf.positions[10 * 2 * 6 - 1]).toBe(positions[positions.length - 1]);
    expect(buf.timestamps[9]).toBe(BigInt(9));
  });

  it("evicts oldest timesteps in chunk-sized blocks when capacity is exceeded", () => {
    // Capacity 30 = 3 × chunk-of-10. Fourth chunk forces eviction.
    const buf = createChunkBuffer(["A"], 30);
    appendChunk(buf, makeChunkPositions(1, 10, 0), makeChunkTimestamps(10, BigInt(0)), new Float32Array(10), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 100), makeChunkTimestamps(10, BigInt(100)), new Float32Array(10), 10);
    appendChunk(buf, makeChunkPositions(1, 10, 200), makeChunkTimestamps(10, BigInt(200)), new Float32Array(10), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(0);

    // Fourth chunk forces eviction of the first 10 timesteps.
    appendChunk(buf, makeChunkPositions(1, 10, 300), makeChunkTimestamps(10, BigInt(300)), new Float32Array(10), 10);
    expect(buf.totalTimesteps).toBe(30);
    expect(buf.bufferStartTimestep).toBe(10);

    // First valid timestep is now what was originally timestep 10 (value 100).
    expect(buf.timestamps[0]).toBe(BigInt(100));
    expect(buf.positions[0]).toBe(100);
    // Last valid timestep is the freshly-appended one (300+59).
    expect(buf.timestamps[29]).toBe(BigInt(309));
  });

  it("returns the number of timesteps shifted (0 if no eviction)", () => {
    const buf = createChunkBuffer(["A"], 30);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), new Float32Array(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), new Float32Array(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), new Float32Array(10), 10),
    ).toBe(0);
    expect(
      appendChunk(buf, makeChunkPositions(1, 10), makeChunkTimestamps(10), new Float32Array(10), 10),
    ).toBe(10);
  });
});

describe("readBodyPositionInto", () => {
  it("reads px/py/pz into the provided Vector3 (no allocation)", () => {
    const buf = createChunkBuffer(["A", "B"], 10);
    // Timestep 2, body 1: write known values into the slot.
    const base = 2 * 2 * 6 + 1 * 6;
    buf.positions[base + 0] = 100;
    buf.positions[base + 1] = 200;
    buf.positions[base + 2] = 300;
    buf.positions[base + 3] = 0.1; // vx — should be ignored
    buf.totalTimesteps = 3;

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 2, 1);
    expect(out.x).toBe(100);
    expect(out.y).toBe(200);
    expect(out.z).toBe(300);
  });
});

describe("readBodyStateInto", () => {
  it("reads position AND velocity into two provided Vector3s", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.positions[0] = 1;
    buf.positions[1] = 2;
    buf.positions[2] = 3;
    buf.positions[3] = 4;
    buf.positions[4] = 5;
    buf.positions[5] = 6;
    buf.totalTimesteps = 1;

    const pos = new THREE.Vector3();
    const vel = new THREE.Vector3();
    readBodyStateInto(pos, vel, buf, 0, 0);
    expect([pos.x, pos.y, pos.z]).toEqual([1, 2, 3]);
    expect([vel.x, vel.y, vel.z]).toEqual([4, 5, 6]);
  });
});

describe("readBodyPositionInto — fractional index (Hermite)", () => {
  it("interpolates position at midpoint via cubic Hermite", () => {
    // Constant velocity → linear position; midpoint = (0.5, 0, 0).
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBeCloseTo(0.5, 10);
    expect(out.y).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it("interpolates non-linear motion correctly via Hermite cubic", () => {
    // Zero tangents at both ends → smoothstep; midpoint = 0.5.
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBeCloseTo(0.5, 10);
  });

  it("scales Hermite tangent terms by dt correctly at non-unit interval", () => {
    // dt = 0.5s. Constant velocity = 2 m/s in x.
    // Linear motion over 0.5s covers 1 m: p0=(0,0,0) → p1=(1,0,0) with v0=v1=(2,0,0).
    // Midpoint (s=0.5) should be (0.5, 0, 0).
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 2, 0, 0,
      1, 0, 0, 2, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 500n]); // dt = 0.5s
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBeCloseTo(0.5, 10);
  });
});

describe("readBodyStateInto — fractional index (Hermite)", () => {
  it("interpolates position and velocity at midpoint via Hermite", () => {
    // Constant velocity → linear position, vel constant.
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 0.5, 0);
    expect(outPos.x).toBeCloseTo(0.5, 10);
    expect(outVel.x).toBeCloseTo(1, 10);
  });

  it("interpolates velocity correctly when endpoints differ", () => {
    // p0=0, v0=0, p1=1, v1=0, dt=1. Smoothstep position.
    // Velocity at s=0.5 = derivative wrt sim-time:
    //   h00'(0.5)=-1.5, h01'(0.5)=1.5, h10'(0.5)=-0.25, h11'(0.5)=-0.25
    //   vel = (-1.5·0 + 1.5·1)/1 + -0.25·0 + -0.25·0 = 1.5 m/s
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 0.5, 0);
    expect(outVel.x).toBeCloseTo(1.5, 10);
  });
});

describe("readBodyPositionInto — boundaries and edge cases", () => {
  it("clamps floatIdx > totalTimesteps - 1 to last keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 0, 0, 0,
      4, 5, 6, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 999, 0);
    expect(out.x).toBe(4);
    expect(out.y).toBe(5);
    expect(out.z).toBe(6);
  });

  it("clamps floatIdx < 0 to first keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 0, 0, 0,
      4, 5, 6, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, -5, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
  });

  it("returns first-keyframe values for a single-keyframe buffer", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([1, 2, 3, 0, 0, 0]);
    const timestamps = new BigInt64Array([0n]);
    appendChunk(buf, positions, timestamps, new Float32Array(1), 1);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
  });
});

describe("readBodyPositionInto — integer index (regression)", () => {
  it("returns stored position exactly at integer keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);

    readBodyPositionInto(out, buf, 1, 0);
    expect(out.x).toBe(4);
    expect(out.y).toBe(5);
    expect(out.z).toBe(6);
  });
});

describe("readBodyStateInto — integer index (regression)", () => {
  it("returns stored position and velocity exactly at integer keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 1, 0);
    expect(outPos.x).toBe(4);
    expect(outPos.y).toBe(5);
    expect(outPos.z).toBe(6);
    expect(outVel.x).toBe(13);
    expect(outVel.y).toBe(14);
    expect(outVel.z).toBe(15);
  });

  it("returns first-keyframe position and velocity when floatIdx is exactly 0", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, new Float32Array(2), 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 0, 0);
    expect(outPos.x).toBe(1);
    expect(outPos.y).toBe(2);
    expect(outPos.z).toBe(3);
    expect(outVel.x).toBe(10);
    expect(outVel.y).toBe(11);
    expect(outVel.z).toBe(12);
  });
});

describe("getTimestamp / getTimestampAsIsoString", () => {
  it("returns raw millis as BigInt and ISO string for a given timestep", () => {
    const buf = createChunkBuffer(["A"], 5);
    const millis = BigInt(Date.UTC(2024, 5, 5));
    buf.timestamps[0] = millis;
    buf.totalTimesteps = 1;

    expect(getTimestamp(buf, 0)).toBe(millis);
    expect(getTimestampAsIsoString(buf, 0)).toBe("2024-06-05T00:00:00.000Z");
  });

  it("returns empty string for out-of-range indices", () => {
    const buf = createChunkBuffer(["A"], 5);
    buf.totalTimesteps = 0;
    expect(getTimestampAsIsoString(buf, 0)).toBe("");
    expect(getTimestampAsIsoString(buf, -1)).toBe("");
    expect(getTimestampAsIsoString(buf, 5)).toBe("");
  });
});

describe("readDeltaERelativeAt", () => {
  it("returns the stored value at integer indices", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    const positions = new Float64Array(3 * 6);
    const timestamps = new BigInt64Array([0n, 1000n, 2000n]);
    const deltaE = new Float32Array([1e-12, 2e-12, 3e-12]);

    appendChunk(buf, positions, timestamps, deltaE, 3);

    expect(readDeltaERelativeAt(buf, 0)).toBeCloseTo(1e-12, 18);
    expect(readDeltaERelativeAt(buf, 1)).toBeCloseTo(2e-12, 18);
    expect(readDeltaERelativeAt(buf, 2)).toBeCloseTo(3e-12, 18);
  });

  it("linearly interpolates at fractional indices", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    const positions = new Float64Array(2 * 6);
    const timestamps = new BigInt64Array([0n, 1000n]);
    const deltaE = new Float32Array([1e-12, 3e-12]);

    appendChunk(buf, positions, timestamps, deltaE, 2);
    expect(readDeltaERelativeAt(buf, 0.5)).toBeCloseTo(2e-12, 18);
  });

  it("returns 0 for an empty buffer", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    expect(readDeltaERelativeAt(buf, 0)).toBe(0);
  });
});

describe("appendChunk — chunk-level DP853 telemetry", () => {
  it("captures latest-write-wins telemetry on each append", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    expect(buf.dp853AvgStepSeconds).toBeNull();
    expect(buf.dp853AcceptRate).toBeNull();

    appendChunk(
      buf,
      new Float64Array(6),
      new BigInt64Array([0n]),
      new Float32Array([0]),
      1,
      3600,
      0.94,
    );
    expect(buf.dp853AvgStepSeconds).toBeCloseTo(3600);
    expect(buf.dp853AcceptRate).toBeCloseTo(0.94);

    // Next chunk overrides — latest-write-wins.
    appendChunk(
      buf,
      new Float64Array(6),
      new BigInt64Array([1000n]),
      new Float32Array([0]),
      1,
      null,
      null,
    );
    expect(buf.dp853AvgStepSeconds).toBeNull();
    expect(buf.dp853AcceptRate).toBeNull();
  });

  // Regression: post-Phase-1, currentTimeStepIndex is a float driven by
  // wall-clock-rate animation. The Phase 1 hotfix (commit 9464608) floored
  // at Trail / DevPanel / TopStatusStrip-buffered sites but missed this
  // selector path (TopStatusStrip + Timeline both consume
  // selectCurrentTimeStepIsoString). With a fractional index,
  // BigInt64Array[3.5] returns undefined → Number(undefined) = NaN →
  // new Date(NaN).toISOString() throws RangeError. Floor inside the
  // function so every caller is protected from float indices.
  it("returns the keyframe-N ISO string when given a fractional index between N and N+1", () => {
    const buf = createChunkBuffer(["A"], 5);
    const t0 = BigInt(Date.UTC(2024, 5, 5, 0));
    const t1 = BigInt(Date.UTC(2024, 5, 5, 4));
    buf.timestamps[0] = t0;
    buf.timestamps[1] = t1;
    buf.totalTimesteps = 2;

    // Should NOT throw and should return the keyframe-0 timestamp
    // (semantically: "you are AT or PAST keyframe 0").
    expect(getTimestampAsIsoString(buf, 0.5)).toBe("2024-06-05T00:00:00.000Z");
    expect(getTimestampAsIsoString(buf, 0.999)).toBe(
      "2024-06-05T00:00:00.000Z",
    );
    expect(getTimestampAsIsoString(buf, 1.5)).toBe(
      "2024-06-05T04:00:00.000Z",
    );
  });
});

describe("clipFitsClientBudget", () => {
  const LOW_MEM = 12 * 1024 * 1024;
  it("accepts the 4-chunk full-catalog clip on a lowMem budget", () => {
    expect(clipFitsClientBudget(40, 4, 1_000, LOW_MEM)).toBe(true);
  });
  it("rejects a 6-chunk 40-body clip on a lowMem budget", () => {
    expect(clipFitsClientBudget(40, 6, 1_000, LOW_MEM)).toBe(false);
  });
});
