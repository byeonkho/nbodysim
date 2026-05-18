# Hermite Phase 1: Frontend Interpolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cubic Hermite interpolation to chunkBuffer's read functions and switch AnimationController to wall-clock-rate float-index driving, producing visually smoother playback between integration samples without any wire-format change.

**Architecture:** Widen the existing `readBodyPositionInto` and `readBodyStateInto` to accept a float `floatIdx`. At integer values, short-circuit to the existing direct typed-array read (zero perf cost — Trail's tail loop and any other integer caller is unaffected). At fractional values, perform inline cubic Hermite using the surrounding two keyframes' positions, velocities, and timestamps. Switch AnimationController from integer-step throttled motion to wall-clock-rate float motion (`delta · FPS · speedMultiplier`), which makes the slice's `currentTimeStepIndex` naturally fractional and propagates through every consumer transparently.

**Tech Stack:** TypeScript, Vitest (frontend tests), React Three Fiber (`useFrame`), Redux Toolkit, Three.js Vector3.

**Spec:** `docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md`

**Branch:** `hermite-frontend` (branch from master once `hermite-spec` merges, OR branch from `hermite-spec` if proceeding before spec merge — confirm with byeon).

---

## File structure

| File | Role | Action |
|---|---|---|
| `frontend/src/app/store/chunkBuffer.ts` | Hermite math + widened read functions | Modify (lines 141-167) |
| `frontend/src/app/store/chunkBuffer.test.ts` | Hermite tests | Modify (extend existing test file) |
| `frontend/src/app/components/scene/AnimationController.tsx` | Wall-clock-rate float driving + drop useSelector subscription | Modify (full rewrite of useFrame body) |
| `frontend/src/app/utils/animationStep.ts` | Pure helper for next-index math (extracted for unit-testability) | Create |
| `frontend/src/app/utils/animationStep.test.ts` | Tests for the helper | Create |
| `frontend/src/app/components/scene/Camera.tsx` | Hoist per-frame Vector3 allocation (opportunistic, per render-loop rules) | Modify |

No other files require changes — every other consumer (`Sphere`, `Trail`, `OrbitPath`, `Reticle`, `GhostLabel`, `BodyCard`, `framePivot`) already passes `currentTimeStepIndex` straight through to the read functions.

---

## Task 1: Regression test for existing integer-index read behavior

**Why first:** Locks in current behavior before changing the implementation, so the s=0 fast path is provably preserved.

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.test.ts` (add new `describe` block)

- [ ] **Step 1: Add a regression `describe` block for `readBodyPositionInto` integer reads.**

Append after the existing tests in `chunkBuffer.test.ts`:

```ts
describe("readBodyPositionInto — integer index (regression)", () => {
  it("returns stored position exactly at integer keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    // Keyframe 0: pos=(1,2,3) vel=(10,11,12)
    // Keyframe 1: pos=(4,5,6) vel=(13,14,15)
    const positions = new Float64Array([
      1, 2, 3, 10, 11, 12,
      4, 5, 6, 13, 14, 15,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

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
    appendChunk(buf, positions, timestamps, 2);

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
});
```

- [ ] **Step 2: Run the new tests, verify they pass against current code.**

Run from repo root:
```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: both new tests pass alongside existing tests.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/app/store/chunkBuffer.test.ts
git commit -m "test(chunkBuffer): regression tests for integer-index reads

Locks in the s=0 fast path behavior before adding Hermite interpolation
in subsequent commits."
```

---

## Task 2: Failing test for fractional Hermite — position

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Add the failing fractional-position test.**

Append after the regression `describe` blocks:

```ts
describe("readBodyPositionInto — fractional index (Hermite)", () => {
  it("interpolates position at midpoint via cubic Hermite", () => {
    // Two keyframes 1 second apart. Pick a motion where Hermite gives a
    // known analytical answer: constant velocity (linear motion).
    // p0=(0,0,0), v0=(1,0,0), p1=(1,0,0), v1=(1,0,0), dt=1s.
    // Linear motion → midpoint exactly (0.5, 0, 0).
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]); // 1 second apart
    appendChunk(buf, positions, timestamps, 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBeCloseTo(0.5, 10);
    expect(out.y).toBeCloseTo(0, 10);
    expect(out.z).toBeCloseTo(0, 10);
  });

  it("interpolates non-linear motion correctly via Hermite cubic", () => {
    // Different start + end velocities → cubic curves through both endpoints.
    // p0=(0,0,0), v0=(0,0,0), p1=(1,0,0), v1=(0,0,0), dt=1s.
    // Hermite with zero tangents at both ends → smoothstep, midpoint = 0.5.
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 0.5, 0);
    // Hermite basis at s=0.5 with zero tangents: h00=0.5, h01=0.5
    // p(0.5) = 0.5·p0 + 0.5·p1 = 0.5·1 = 0.5
    expect(out.x).toBeCloseTo(0.5, 10);
  });
});
```

- [ ] **Step 2: Run, verify the new tests fail.**

```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: existing tests pass; the two new fractional tests **fail** because current `readBodyPositionInto` does `out.x = buffer.positions[base]` with `base = Math.floor(0.5) * stride + ...` — it'll silently floor to keyframe 0, returning (0,0,0) instead of (0.5,0,0).

---

## Task 3: Implement Hermite for `readBodyPositionInto`

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts:141-151`

- [ ] **Step 1: Replace `readBodyPositionInto` with the widened, Hermite-aware version.**

Find the existing function (around line 141):

```ts
// Caller provides the output Vector3 — never allocates per call. Designed
// to be called inside useFrame at FPS rate.
export function readBodyPositionInto(
  out: ThreeVector3,
  buffer: ChunkBuffer,
  timestepIdx: number,
  bodyIdx: number,
): void {
  const base = timestepIdx * buffer.bodyCount * 6 + bodyIdx * 6;
  out.x = buffer.positions[base];
  out.y = buffer.positions[base + 1];
  out.z = buffer.positions[base + 2];
}
```

Replace with:

```ts
// Caller provides the output Vector3 — never allocates per call. Designed
// to be called inside useFrame at FPS rate.
//
// floatIdx ∈ [0, totalTimesteps - 1]. Integer values short-circuit to a
// direct typed-array read (zero perf cost; preserves existing s=0 behavior
// for callers like Trail's tail loop). Fractional values invoke cubic
// Hermite between floor(floatIdx) and floor(floatIdx) + 1, using the stored
// velocities as exact tangents and per-keyframe timestamps for the interval.
export function readBodyPositionInto(
  out: ThreeVector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void {
  // Boundary clamp: at or past last keyframe → exact last-keyframe read.
  // Before first keyframe → exact first-keyframe read. Single-keyframe
  // buffer (totalTimesteps === 1) also lands here.
  if (floatIdx <= 0 || buffer.totalTimesteps <= 1) {
    const base = 0 * buffer.bodyCount * 6 + bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }
  if (floatIdx >= buffer.totalTimesteps - 1) {
    const base =
      (buffer.totalTimesteps - 1) * buffer.bodyCount * 6 + bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }

  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;

  // Fast path: exactly on a keyframe. Single typed-array read, no Hermite.
  if (s === 0) {
    const base = i0 * buffer.bodyCount * 6 + bodyIdx * 6;
    out.x = buffer.positions[base];
    out.y = buffer.positions[base + 1];
    out.z = buffer.positions[base + 2];
    return;
  }

  // Hermite path. Compute basis once.
  const stride = buffer.bodyCount * 6;
  const base0 = i0 * stride + bodyIdx * 6;
  const base1 = base0 + stride;

  const dtMs = Number(buffer.timestamps[i0 + 1] - buffer.timestamps[i0]);
  const dt = dtMs / 1000; // velocities are m/s; convert ms → s

  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  // Per-axis Hermite. Velocities live at base+3..+5.
  const p0x = buffer.positions[base0];
  const p0y = buffer.positions[base0 + 1];
  const p0z = buffer.positions[base0 + 2];
  const v0x = buffer.positions[base0 + 3];
  const v0y = buffer.positions[base0 + 4];
  const v0z = buffer.positions[base0 + 5];
  const p1x = buffer.positions[base1];
  const p1y = buffer.positions[base1 + 1];
  const p1z = buffer.positions[base1 + 2];
  const v1x = buffer.positions[base1 + 3];
  const v1y = buffer.positions[base1 + 4];
  const v1z = buffer.positions[base1 + 5];

  out.x = h00 * p0x + h10 * dt * v0x + h01 * p1x + h11 * dt * v1x;
  out.y = h00 * p0y + h10 * dt * v0y + h01 * p1y + h11 * dt * v1y;
  out.z = h00 * p0z + h10 * dt * v0z + h01 * p1z + h11 * dt * v1z;
}
```

- [ ] **Step 2: Run all chunkBuffer tests, verify they pass.**

```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: all tests pass — regression tests still green, new fractional tests now green.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "feat(chunkBuffer): cubic Hermite interpolation in readBodyPositionInto

Widens the existing function to accept float idx. Integer values use the
existing direct read (zero perf cost). Fractional values perform inline
cubic Hermite using stored velocities as tangents and per-keyframe
timestamps for the interval — no allocations, same caller-provided
scratch pattern."
```

---

## Task 4: Hermite for `readBodyStateInto` (position + velocity)

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts:153-167`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Add the failing fractional-state test.**

Append to `chunkBuffer.test.ts`:

```ts
describe("readBodyStateInto — fractional index (Hermite)", () => {
  it("interpolates position and velocity at midpoint via Hermite", () => {
    // Constant velocity → linear position, constant velocity at all s.
    // p0=(0,0,0), v0=(1,0,0), p1=(1,0,0), v1=(1,0,0), dt=1s.
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 1, 0, 0,
      1, 0, 0, 1, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 0.5, 0);
    expect(outPos.x).toBeCloseTo(0.5, 10);
    expect(outVel.x).toBeCloseTo(1, 10); // constant-velocity case
  });

  it("interpolates velocity correctly when endpoints differ", () => {
    // p0=(0,0,0), v0=(0,0,0), p1=(1,0,0), v1=(0,0,0), dt=1s.
    // Smoothstep position. Velocity at s=0.5 = derivative of smoothstep
    // wrt sim-time = (h00'·p0 + h01'·p1)/dt + h10'·v0 + h11'·v1.
    // h00'(0.5) = 6·0.5² - 6·0.5 = -1.5
    // h01'(0.5) = -6·0.5² + 6·0.5 =  1.5
    // h10'(0.5) = 3·0.5² - 4·0.5 + 1 = 0.75 - 2 + 1 = -0.25
    // h11'(0.5) = 3·0.5² - 2·0.5 = 0.75 - 1 = -0.25
    // velocity = (-1.5·0 + 1.5·1)/1 + -0.25·0 + -0.25·0 = 1.5 m/s
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      0, 0, 0, 0, 0, 0,
      1, 0, 0, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const outPos = new THREE.Vector3();
    const outVel = new THREE.Vector3();
    readBodyStateInto(outPos, outVel, buf, 0.5, 0);
    expect(outVel.x).toBeCloseTo(1.5, 10);
  });
});
```

- [ ] **Step 2: Run, verify the new state tests fail.**

```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: new tests fail (current code returns floored-keyframe state, no interpolation).

- [ ] **Step 3: Replace `readBodyStateInto` with the widened version.**

Find the existing function (around line 153):

```ts
export function readBodyStateInto(
  outPos: ThreeVector3,
  outVel: ThreeVector3,
  buffer: ChunkBuffer,
  timestepIdx: number,
  bodyIdx: number,
): void {
  const base = timestepIdx * buffer.bodyCount * 6 + bodyIdx * 6;
  outPos.x = buffer.positions[base];
  outPos.y = buffer.positions[base + 1];
  outPos.z = buffer.positions[base + 2];
  outVel.x = buffer.positions[base + 3];
  outVel.y = buffer.positions[base + 4];
  outVel.z = buffer.positions[base + 5];
}
```

Replace with:

```ts
// Caller provides both output Vector3s — never allocates per call.
//
// floatIdx ∈ [0, totalTimesteps - 1]. Integer values short-circuit to
// direct typed-array reads. Fractional values perform cubic Hermite for
// position (using stored velocities as tangents) AND its analytic
// derivative for velocity. Velocity at integer keyframes equals the
// stored value exactly; velocity at fractional indices is consistent
// with the Hermite-interpolated position.
export function readBodyStateInto(
  outPos: ThreeVector3,
  outVel: ThreeVector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void {
  if (floatIdx <= 0 || buffer.totalTimesteps <= 1) {
    const base = 0 * buffer.bodyCount * 6 + bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }
  if (floatIdx >= buffer.totalTimesteps - 1) {
    const base =
      (buffer.totalTimesteps - 1) * buffer.bodyCount * 6 + bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }

  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;

  if (s === 0) {
    const base = i0 * buffer.bodyCount * 6 + bodyIdx * 6;
    outPos.x = buffer.positions[base];
    outPos.y = buffer.positions[base + 1];
    outPos.z = buffer.positions[base + 2];
    outVel.x = buffer.positions[base + 3];
    outVel.y = buffer.positions[base + 4];
    outVel.z = buffer.positions[base + 5];
    return;
  }

  const stride = buffer.bodyCount * 6;
  const base0 = i0 * stride + bodyIdx * 6;
  const base1 = base0 + stride;

  const dtMs = Number(buffer.timestamps[i0 + 1] - buffer.timestamps[i0]);
  const dt = dtMs / 1000;

  const s2 = s * s;
  const s3 = s2 * s;

  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;

  // Derivatives of the basis wrt s.
  const dh00 = 6 * s2 - 6 * s;
  const dh10 = 3 * s2 - 4 * s + 1;
  const dh01 = -6 * s2 + 6 * s;
  const dh11 = 3 * s2 - 2 * s;
  const invDt = 1 / dt;

  const p0x = buffer.positions[base0];
  const p0y = buffer.positions[base0 + 1];
  const p0z = buffer.positions[base0 + 2];
  const v0x = buffer.positions[base0 + 3];
  const v0y = buffer.positions[base0 + 4];
  const v0z = buffer.positions[base0 + 5];
  const p1x = buffer.positions[base1];
  const p1y = buffer.positions[base1 + 1];
  const p1z = buffer.positions[base1 + 2];
  const v1x = buffer.positions[base1 + 3];
  const v1y = buffer.positions[base1 + 4];
  const v1z = buffer.positions[base1 + 5];

  outPos.x = h00 * p0x + h10 * dt * v0x + h01 * p1x + h11 * dt * v1x;
  outPos.y = h00 * p0y + h10 * dt * v0y + h01 * p1y + h11 * dt * v1y;
  outPos.z = h00 * p0z + h10 * dt * v0z + h01 * p1z + h11 * dt * v1z;

  // Velocity = d/dt of position. Chain rule: ds/dt = 1/dt for the basis,
  // tangent terms have an extra dt that cancels.
  outVel.x = (dh00 * p0x + dh01 * p1x) * invDt + dh10 * v0x + dh11 * v1x;
  outVel.y = (dh00 * p0y + dh01 * p1y) * invDt + dh10 * v0y + dh11 * v1y;
  outVel.z = (dh00 * p0z + dh01 * p1z) * invDt + dh10 * v0z + dh11 * v1z;
}
```

- [ ] **Step 4: Run all chunkBuffer tests, verify they pass.**

```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: all tests pass — regression tests, position-Hermite tests, state-Hermite tests all green.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/app/store/chunkBuffer.ts frontend/src/app/store/chunkBuffer.test.ts
git commit -m "feat(chunkBuffer): cubic Hermite interpolation in readBodyStateInto

Velocity at fractional indices = analytic derivative of the Hermite
position curve. At integer keyframes velocity equals the stored value
exactly; at fractional values it stays consistent with the interpolated
position so OrbitPath's Keplerian fit (the main fractional consumer of
state) sees a coherent (r, v) pair."
```

---

## Task 5: Boundary and edge-case tests

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`

- [ ] **Step 1: Add boundary and single-keyframe tests.**

Append:

```ts
describe("readBodyPositionInto — boundaries and edge cases", () => {
  it("clamps floatIdx > totalTimesteps - 1 to last keyframe", () => {
    const buf = createChunkBuffer(["Earth"], 4);
    const positions = new Float64Array([
      1, 2, 3, 0, 0, 0,
      4, 5, 6, 0, 0, 0,
    ]);
    const timestamps = new BigInt64Array([0n, 1000n]);
    appendChunk(buf, positions, timestamps, 2);

    const out = new THREE.Vector3();
    readBodyPositionInto(out, buf, 999, 0); // way past end
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
    appendChunk(buf, positions, timestamps, 2);

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
    appendChunk(buf, positions, timestamps, 1);

    const out = new THREE.Vector3();
    // Even at fractional, no Hermite possible → should return keyframe 0.
    readBodyPositionInto(out, buf, 0.5, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(2);
    expect(out.z).toBe(3);
  });
});
```

- [ ] **Step 2: Run all chunkBuffer tests, verify pass.**

```bash
cd frontend && npm test -- chunkBuffer.test.ts
```

Expected: all green.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/app/store/chunkBuffer.test.ts
git commit -m "test(chunkBuffer): boundary clamping and single-keyframe edge cases

Out-of-range float indices clamp to first/last keyframe; single-keyframe
buffer falls back gracefully to the only keyframe's stored values."
```

---

## Task 6: Extract `computeNextIndex` helper for AnimationController

**Why extract:** AnimationController is tightly coupled to R3F's `useFrame` and the redux store, making it hard to unit-test directly. The next-index math is pure — extracting it lets us TDD that independently and reduces AnimationController to a thin wiring layer.

**Files:**
- Create: `frontend/src/app/utils/animationStep.ts`
- Create: `frontend/src/app/utils/animationStep.test.ts`

- [ ] **Step 1: Write the failing test.**

Create `frontend/src/app/utils/animationStep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeNextIndex } from "./animationStep";

describe("computeNextIndex", () => {
  it("at speedMultiplier=1, FPS=60, delta=1/60s → moves 1 unit forward", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: 1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(101, 10);
  });

  it("at speedMultiplier=2, doubles the step rate", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: 2,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(102, 10);
  });

  it("negative speedMultiplier moves backward", () => {
    const next = computeNextIndex({
      currentIndex: 100,
      delta: 1 / 60,
      speedMultiplier: -1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(99, 10);
  });

  it("clamps to upper bound at totalTimesteps - 1", () => {
    const next = computeNextIndex({
      currentIndex: 9_999.5,
      delta: 1 / 60,
      speedMultiplier: 100,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBe(9_999);
  });

  it("clamps to lower bound at 0", () => {
    const next = computeNextIndex({
      currentIndex: 0.5,
      delta: 1 / 60,
      speedMultiplier: -100,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBe(0);
  });

  it("returns fractional values for sub-frame motion", () => {
    // At 144Hz with speedMultiplier=1, delta ≈ 1/144, expected step ≈ 60/144 ≈ 0.417
    const next = computeNextIndex({
      currentIndex: 0,
      delta: 1 / 144,
      speedMultiplier: 1,
      fps: 60,
      totalTimesteps: 10_000,
    });
    expect(next).toBeCloseTo(60 / 144, 6);
  });
});
```

- [ ] **Step 2: Run, verify the tests fail with "module not found" or "computeNextIndex is not a function".**

```bash
cd frontend && npm test -- animationStep.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation.**

Create `frontend/src/app/utils/animationStep.ts`:

```ts
// Pure helper for AnimationController's per-frame index update. Extracted
// for unit-testability — AnimationController itself is tightly coupled to
// R3F's useFrame and the redux store, but the math is just arithmetic +
// clamping.
//
// The drive model is wall-clock-rate: per real-world second of elapsed
// playback, the simulation advances `speedMultiplier * fps` keyframe units.
// At fps=60 and speedMultiplier=1 this exactly matches the legacy
// integer-step throttled behavior (one step per 1/60s frame). At higher
// refresh rates, the per-frame step naturally shrinks below 1.0 — the
// chunkBuffer reads will Hermite-interpolate.
//
// Output is a float; clamped to [0, totalTimesteps - 1].
export interface ComputeNextIndexInput {
  currentIndex: number;
  delta: number;          // seconds since last frame (from R3F useFrame)
  speedMultiplier: number; // signed; magnitude scales rate, sign sets direction
  fps: number;            // nominal sim FPS — defines the "1 unit per frame" baseline
  totalTimesteps: number; // upper-bound (clamp at totalTimesteps - 1)
}

export function computeNextIndex(input: ComputeNextIndexInput): number {
  const { currentIndex, delta, speedMultiplier, fps, totalTimesteps } = input;
  const proposed = currentIndex + delta * fps * speedMultiplier;
  if (proposed < 0) return 0;
  if (proposed > totalTimesteps - 1) return totalTimesteps - 1;
  return proposed;
}
```

- [ ] **Step 4: Run tests, verify they pass.**

```bash
cd frontend && npm test -- animationStep.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/app/utils/animationStep.ts frontend/src/app/utils/animationStep.test.ts
git commit -m "feat(animation): extract computeNextIndex helper for wall-clock-rate driving

Pure function — proposed index = current + delta·fps·speedMultiplier,
clamped to [0, totalTimesteps - 1]. Output is float; the chunkBuffer
read functions handle interpolation between keyframes. AnimationController
will switch to using this in the next commit."
```

---

## Task 7: Wire AnimationController to the new helper + drop useSelector subscription

**Files:**
- Modify: `frontend/src/app/components/scene/AnimationController.tsx`

This task has no automated test — AnimationController is verified visually in the dev server (Task 9). The wiring is small and the math is already covered by Task 6.

- [ ] **Step 1: Replace the entire `AnimationController` component body.**

Open `frontend/src/app/components/scene/AnimationController.tsx`. Replace the file's contents with:

```tsx
"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";
import {
  selectIsPaused,
  selectSpeedMultiplier,
  setCurrentTimeStepIndex,
} from "@/app/store/slices/SimulationSlice";
import SimConstants from "@/app/constants/SimConstants";
import { AppDispatch, RootState } from "@/app/store/Store";
import { computeNextIndex } from "@/app/utils/animationStep";

const AnimationController = () => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();
  // Note: NOT subscribing to currentTimeStepIndex via useSelector — this
  // component dispatches that value every frame, so a selector subscription
  // would re-render every frame (the known offender flagged in
  // frontend-render-loop.md). We read it imperatively from store.getState()
  // inside useFrame instead.
  const isPaused = useSelector(selectIsPaused);
  const speedMultiplier = useSelector(selectSpeedMultiplier);

  const isPausedRef = useRef(isPaused);
  const speedMultiplierRef = useRef(speedMultiplier);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  useEffect(() => {
    speedMultiplierRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useFrame((_, delta) => {
    if (isPausedRef.current) return;

    const state = store.getState();
    const buffer = state.simulation.chunkBuffer;
    if (!buffer || buffer.totalTimesteps === 0) return;

    const currentIndex = state.simulation.timeState.currentTimeStepIndex;
    const nextIndex = computeNextIndex({
      currentIndex,
      delta,
      speedMultiplier: speedMultiplierRef.current,
      fps: SimConstants.FPS,
      totalTimesteps: buffer.totalTimesteps,
    });

    if (nextIndex !== currentIndex) {
      dispatch(setCurrentTimeStepIndex(nextIndex));
    }
  });

  return null;
};

export default AnimationController;
```

Changes from the previous version:
- Dropped `selectCurrentTimeStepIndex` import + selector subscription + matching ref/useEffect.
- Dropped `FRAME_INTERVAL` accumulator (`accRef`, `FRAME_INTERVAL` constant). Wall-clock-rate driving is naturally framerate-independent — no need to throttle.
- Index math delegated to `computeNextIndex`.
- Comparison `nextIndex !== currentIndex` skips the dispatch when motion would be zero (paused already-handled; this catches the edge where clamp produced no movement).

- [ ] **Step 2: Run frontend lint + tests to confirm no compilation issues.**

```bash
cd frontend && npm run lint && npm test
```

Expected: lint passes, all tests still pass.

- [ ] **Step 3: Commit.**

```bash
git add frontend/src/app/components/scene/AnimationController.tsx
git commit -m "refactor(scene): wall-clock-rate float-index driving in AnimationController

Switches from throttled integer-step motion to wall-clock-rate float motion
via the new computeNextIndex helper. currentTimeStepIndex becomes a float;
all chunkBuffer consumers transparently propagate it.

Also drops the useSelector subscription on currentTimeStepIndex (a known
offender per frontend-render-loop.md — this component dispatched the same
value every frame, causing a render cascade). Reads imperatively via
store.getState() inside useFrame instead."
```

---

## Task 8: Camera per-frame Vector3 allocation cleanup (opportunistic)

**Why now:** Spec calls for fixing this opportunistically while in the file for Phase 1's smoothness verification. The file is already in scope.

**Files:**
- Modify: `frontend/src/app/components/scene/Camera.tsx`

- [ ] **Step 1: Read the file to locate the per-frame allocation.**

```bash
cd /Users/byeonkho/code/spacesim && grep -n "new THREE.Vector3" frontend/src/app/components/scene/Camera.tsx
```

Expected: shows the allocation site(s) inside `useFrame`.

- [ ] **Step 2: Hoist allocation(s) to module-level scratch vectors (or `useRef` if the camera component re-mounts).**

Pattern: replace `const v = new THREE.Vector3()` inside `useFrame` with:

```tsx
// At module level, above the component:
const scratchVec = new THREE.Vector3();

// Inside useFrame, replace `new THREE.Vector3()` with reuse-then-reset:
scratchVec.set(0, 0, 0);
// ... use scratchVec ...
```

If Camera might mount multiple times (check if it does), use `useRef(new THREE.Vector3())` instead, accessed as `scratchVecRef.current`. The render-loop rules note `Camera` is a single instance, so module-level is fine.

- [ ] **Step 3: Run frontend tests + lint to confirm no breakage.**

```bash
cd frontend && npm run lint && npm test
```

Expected: all green.

- [ ] **Step 4: Commit.**

```bash
git add frontend/src/app/components/scene/Camera.tsx
git commit -m "perf(scene): hoist per-frame Vector3 allocation in Camera

Removes a per-frame allocation flagged in frontend-render-loop.md as a
known offender. Opportunistic cleanup while in the file for Phase 1
smoothness verification."
```

---

## Task 9: Full verification — build, lint, tests, manual smoothness check

**Files:** none (verification only).

- [ ] **Step 1: Run the full backend + frontend verify per CLAUDE.md.**

```bash
cd /Users/byeonkho/code/spacesim/frontend && npm run build && npm run lint && npm test
```

Expected: build succeeds, lint clean, all tests pass.

- [ ] **Step 2: Start the backend.**

```bash
cd /Users/byeonkho/code/spacesim/backend && ./mvnw spring-boot:run
```

Expected: starts on port 8080, no errors in logs.

- [ ] **Step 3: Start the frontend dev server.**

```bash
cd /Users/byeonkho/code/spacesim/frontend && npm run dev
```

Expected: starts on port 3000.

- [ ] **Step 4: Manual verification checklist.**

In a browser at `http://localhost:3000`:

- [ ] Submit a default sim. Wait for first chunk to load.
- [ ] Press play at speedMultiplier=1. **Verify:** motion is visibly smoother than master — no per-step stutter; bodies appear to move continuously between integration samples.
- [ ] Open the Stats overlay (DevPanel or Stats.js). **Verify:** steady-state FPS is the same as master under the same scene + body count (no measurable regression).
- [ ] Increase speedMultiplier to +5 or higher. **Verify:** motion stays smooth, no drift in position vs. master at the same sim time.
- [ ] Set speedMultiplier to -1. **Verify:** smooth backward playback.
- [ ] Pause. Drag the scrubber to a different position. **Verify:** scene snaps to the scrubbed time, all bodies land in the right spot.
- [ ] Click on a body to focus. **Verify:** camera follows the body smoothly through fractional time positions.
- [ ] With a body focused, observe the orbit path. **Verify:** orbit ellipse stays correct and stable through animation (Hermite-interpolated velocity flowing into Keplerian fit doesn't introduce wobble).
- [ ] Observe a body's trail. **Verify:** trail head sits exactly on the body (no lag, no jump); trail body looks identical to master.
- [ ] Toggle helio ↔ geo display frame. **Verify:** Earth pivots correctly in geo mode; no jitter introduced by Hermite at the pivot.

If anything regresses: stop, diagnose, fix before declaring done.

- [ ] **Step 5: Push the branch.**

```bash
cd /Users/byeonkho/code/spacesim && git push -u origin hermite-frontend
```

- [ ] **Step 6: Open the PR.**

```bash
gh pr create --title "Phase 1: Cubic Hermite interpolation + wall-clock-rate animation driving" --body "$(cat <<'EOF'
## Summary

- Widens `readBodyPositionInto` and `readBodyStateInto` in chunkBuffer to accept float `floatIdx` — integer values short-circuit to direct typed-array reads (zero perf cost), fractional values perform inline cubic Hermite using stored velocities as tangents.
- Switches AnimationController from integer-step throttled motion to wall-clock-rate float motion via a new `computeNextIndex` helper. Drops the FRAME_INTERVAL accumulator (no longer needed — wall-clock driving is framerate-independent) and the useSelector subscription on `currentTimeStepIndex` (known render-cascade offender).
- Opportunistic cleanup: per-frame `new THREE.Vector3` allocation in Camera hoisted to module scratch.

Spec: `docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md`

Phase 1 of 3. Phase 2 (backend keyframe thinning) and Phase 3 (SimParams UI) follow after this verifies + merges.

## Test plan

- [ ] `npm test` passes (chunkBuffer Hermite tests, animationStep helper tests, all existing tests still green)
- [ ] `npm run build && npm run lint` clean
- [ ] Manual smoothness check (see Task 9 in `docs/superpowers/plans/2026-05-15-hermite-phase-1-frontend-interpolation.md` step 4)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Stop here — do NOT poll CI per `.claude/rules/no-ci-polling.md`. Report PR URL and end.

---

## Self-review checklist (verified before handing off plan)

**Spec coverage:**
- [x] Hermite math in `readBodyPositionInto` (Task 3)
- [x] Hermite math in `readBodyStateInto` (Task 4)
- [x] Boundary handling (clamp at both ends) (Tasks 3, 4, 5)
- [x] Single-keyframe edge case (Task 5)
- [x] s=0 fast path / regression coverage (Task 1)
- [x] Wall-clock-rate driving in AnimationController (Tasks 6, 7)
- [x] Drop useSelector subscription on `currentTimeStepIndex` (Task 7)
- [x] Camera per-frame allocation cleanup (Task 8)
- [x] Verify criterion: smoothness, FPS, scrubber, click-focus, orbit-path, trail (Task 9 manual checklist)

**Type / signature consistency:**
- `ComputeNextIndexInput` shape used in Task 6 matches the call in Task 7. ✓
- `readBodyPositionInto` / `readBodyStateInto` signatures unchanged externally — only docstring + behavior. ✓

**Placeholder scan:** No TBD / TODO / fill-in markers. Every step shows the exact code or command.
