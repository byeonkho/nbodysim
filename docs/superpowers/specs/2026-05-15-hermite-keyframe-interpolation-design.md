# Hermite keyframe interpolation + backend keyframe thinning

**Date:** 2026-05-15
**Status:** Design — awaiting implementation
**Tracker entry:** `todo.md` #20 (originally "Catmull-Rom interpolation"; revised to cubic Hermite)
**Related:** `todo.md` #37 (per-chunk bandwidth optimisation), #68 (DP853 native adaptive substep — depends on this work landing first)

## Summary

Replace the current behavior — backend ships every integration step, frontend snaps directly to discrete samples — with cubic Hermite interpolation between sparser, backend-thinned keyframes. Two payoffs: smoother animation between samples (independent of bandwidth), and a per-request bandwidth lever (skip every Kth raw step). Three independent rollout phases, each verifiable on its own.

## Goals

- Smoother visual playback between integration samples — no per-step "stutter" at any playback speed.
- Reduce per-chunk bandwidth via configurable keyframe thinning, with sensible per-integrator defaults.
- User-visible "Playback quality" control surfaced in SimParams.
- Zero correctness regressions; existing scrubber, click-to-focus, and orbit-path behavior preserved.

## Non-goals

- Re-timing adaptive integrators onto a different sample grid. (DP853 is currently driven at fixed external dt — see `Investigation findings` below — so re-timing collapses to a no-op.)
- Exposing DP853's native adaptive substep cadence. Filed as `todo.md` #68; depends on this work landing first.
- Changing the wire format. Per-keyframe timestamps are already shipped; only the read side needs to honor non-uniform spacing.
- Float32 quantization of position/velocity (see `todo.md` #37 — orthogonal future bandwidth lever).

## Investigation findings

Before locking the design, the integrator pipeline was audited:

1. **Backend ships state vectors (px, py, pz, vx, vy, vz) per body per timestep**, see `BinaryResponseSerializer.java:88-94`. Velocities are already on the wire — Hermite has the data it needs without a protocol change.

2. **Frontend chunkBuffer already stores velocities** alongside positions in the same flat typed-array. `readBodyStateInto` (no-allocation, scratch-vector pattern) already exists in `chunkBuffer.ts:153`.

3. **All three integrators emit uniform-time samples.** `Simulation.run()` (`Simulation.java:115-119`) is a fixed-dt loop calling `integrator.stepInto(out, state, dt, derivatives)`. DP853's adaptive behavior is *internal* to its `stepInto` call (Hipparchus substeps adaptively to land at t+dt with tight tolerances) but the substeps are discarded; only the endpoint is returned. Consequence: the original "re-timing for adaptive integrators" lever is unnecessary today.

4. **Per-keyframe timestamps are already in the wire format** (`int64 millis` per timestep). The format never assumed uniform spacing — frontend code did. After this work, that assumption is removed.

5. **Hot-path discipline applies.** `frontend-render-loop.md` and `backend-sim-step.md` both apply. New code must avoid per-frame allocations, avoid per-step allocations in the integrator/serializer loops, and respect the existing scratch-buffer + caller-provided-output patterns.

## Algorithm — cubic Hermite vs. Catmull-Rom

Both are cubic splines through control points. The difference is how the tangent at each point is computed:

- **Catmull-Rom** estimates the tangent at point P₁ as `(P₂ − P₀) / 2` — a finite difference of neighboring positions. Wrong by O(dt²) compared to the true derivative.
- **Cubic Hermite** uses an explicit tangent at each endpoint. We have the integrator's exact velocity at every keyframe, so the tangent IS the velocity — no estimation.

Same flop count (~30 per axis per body per frame, ~90 total per body per frame). Hermite is strictly more accurate at every sample point and degrades more gracefully as keyframes are thinned (Catmull-Rom's tangent estimates degrade with sparser sampling; Hermite's tangents are still exact). Hermite's analytic derivative also gives interpolated velocity matching the integrator exactly at keyframes — directly usable by `OrbitPath` for its Keplerian fit.

### Hermite math (the form used)

Between keyframes `i` and `i+1` with timestamps `t0`, `t1` (in seconds):

```
s = floatIdx - floor(floatIdx)        # ∈ [0, 1]
dt = t1 - t0

h00 = 2s³ - 3s² + 1
h10 = s³ - 2s² + s
h01 = -2s³ + 3s²
h11 = s³ - s²

p(s)  = h00·p0 + h10·dt·v0 + h01·p1 + h11·dt·v1
p'(s) = (h00'·p0 + h01'·p1) / dt + h10'·v0 + h11'·v1
```

Computed inline per axis against the typed-array backing store. No Three.js wrapper objects, no allocations.

## Rollout — three phases

Each phase ships on its own branch, opens its own PR, and waits for explicit verify-and-merge before the next phase begins. Per `branch-workflow.md`.

| Phase | Branch | Scope | Independent verify criterion |
|---|---|---|---|
| 1 | `hermite-frontend` | Frontend Hermite + float-keyframe index. Zero protocol change. | Animation visibly smoother at any speed; chunk sizes unchanged; FPS unchanged. |
| 2 | `hermite-backend-thinning` | Backend honors `keyframeIntervalSec` request param. Frontend sends `stepDt` (no change). | Sending `stepDt` produces identical chunk sizes; sending `4·stepDt` produces ~75% smaller chunks; cross-chunk continuity preserved. |
| 3 | `hermite-ui` | Per-integrator default N + 5-preset SimParams control + custom override. | User sees "Playback quality" control; switching integrators auto-selects preset; payload size in DevTools matches selection. |

## Phase 1 — Frontend Hermite (no protocol change)

### Animation drive model

`AnimationController.tsx` currently advances `currentTimeStepIndex` by integer `speedMultiplier` per frame fire. With integer index, there's nothing fractional for Hermite to interpolate.

Switch to wall-clock-rate driving:

```
nextIndex = currentIndex + (delta · stepsPerSec · direction)
```

where `stepsPerSec = speedMultiplier · FPS`. Preserves today's behavior at speedMultiplier=1 (same total displacement per second), but `currentTimeStepIndex` becomes a float. Bonus: playback rate becomes framerate-independent.

The accumulator/throttle pattern (`accRef`, `FRAME_INTERVAL`) stays — fires at FPS rate.

### Slice changes — `SimulationSlice.ts`

- `currentTimeStepIndex: number` — type unchanged; semantics now "float over kept keyframes; integer = on a keyframe, fractional = interpolated."
- `setCurrentTimeStepIndex(payload: number)` — accepts float. Clamping `[0, totalTimesteps - 1]` unchanged.
- Eviction-shift handler at line 252-254 (`currentTimeStepIndex - shifted`) works for floats with no change.
- Scrubber stays integer (`Math.round(...)` in `Timeline.tsx:182`) — fractional scrubbing adds nothing perceptible.

### chunkBuffer changes — `chunkBuffer.ts`

**Widen the existing `readBodyPositionInto` and `readBodyStateInto` to accept a float idx**, rather than adding parallel `*AtFrac` functions. Function signatures and existing call sites unchanged. Internal behavior:

- At integer idx (the s=0 case), short-circuit to direct typed-array read — same path as today, single-branch overhead.
- At fractional idx, perform cubic Hermite against the surrounding keyframes inline.

Allocation-free, caller-provided scratch vectors throughout (existing pattern preserved).

```ts
// Signature unchanged; doc comment updated:
// floatIdx ∈ [0, totalTimesteps - 1]. Integer = exact keyframe read.
// Fractional = cubic Hermite between floor(floatIdx) and floor(floatIdx) + 1
// using stored velocities as tangents.
readBodyPositionInto(
  out: Vector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void

readBodyStateInto(
  outPos: Vector3,
  outVel: Vector3,
  buffer: ChunkBuffer,
  floatIdx: number,
  bodyIdx: number,
): void
```

Why widen instead of adding new functions: every consumer (`Sphere`, `Trail`, `OrbitPath`, `Reticle`, `GhostLabel`, `Camera`, `BodyCard`, `framePivot`) currently passes the slice's `currentTimeStepIndex` straight through. After `AnimationController` makes that value a float, the consumers transparently forward it. No call-site migrations needed beyond AnimationController itself. Trail's tail loop still passes integer `i` and gets exact-keyframe values via the s=0 fast path — zero perf cost.

Boundary handling: `floatIdx >= totalTimesteps - 1` → clamp to last keyframe (no Hermite). `floatIdx < 0` → clamp to first. No special-case across raw-chunk boundaries because the buffer is contiguous regardless of which chunk a keyframe came from.

### Scene consumer audit

Per `frontend-render-loop.md` "audit EVERY consumer" rule. Because we widened `readBodyPositionInto` / `readBodyStateInto` rather than adding parallel functions, **none of the consumer files require code changes** — they already pass the slice's `currentTimeStepIndex` through to the read APIs unchanged. The audit confirms each consumer transparently propagates whatever index it receives:

| File | Reads via | Index source | Notes |
|---|---|---|---|
| `Sphere.tsx` | `readBodyPositionInto` ×2 | `currentTimeStepIndex` (becomes float) | Body + parent reads — both pass the same float idx |
| `Trail.tsx` | `readBodyPositionInto` ×2 in tail loop | `i` (always integer) | Tail uses s=0 fast path, no Hermite cost |
| `OrbitPath.tsx` | `readBodyStateInto` ×2 | `currentTimeStepIndex` (becomes float) | Body + parent state — Hermite-interpolated velocity flows into Keplerian fit naturally |
| `Reticle.tsx` | `readBodyPositionInto` | `currentTimeStepIndex` (becomes float) | |
| `GhostLabel.tsx` | `readBodyPositionInto` ×3 | `currentTimeStepIndex` (becomes float) | |
| `Camera.tsx` | `readBodyPositionInto` (via `framePivot`) | `currentTimeStepIndex` (becomes float) | Existing per-frame `new THREE.Vector3` allocation (flagged in render-loop rules as known offender) — fix opportunistically while in the file for visual smoothness verification |
| `framePivot.ts` | `readBodyPositionInto` | passed-through `timestepIdx` | No signature change; just inherits the widened function's behavior |
| `BodyCard.tsx` | `readBodyStateInto` ×3 | `currentTimeStepIndex` (becomes float) | Display strings naturally show fractional state |

The only file with active code changes besides `chunkBuffer.ts` is `AnimationController.tsx` (drive-model switch + offender cleanup), plus the opportunistic `Camera.tsx` allocation fix.

### AnimationController known-offender cleanup

Currently subscribes to `currentTimeStepIndex` via `useSelector` then dispatches it every frame — re-renders every frame. Flagged in `frontend-render-loop.md` as a known offender. Recommend folding the fix in here: switch to imperative `store.getState()` inside `useFrame`, drop the selector subscription. Same file, same set of refs, the change is already adjacent.

### Hot-path discipline

- All Hermite math inline against typed arrays.
- Caller-provided scratch vectors throughout (matches existing `readBody*Into` pattern).
- Per-frame cost: O(N_bodies) Hermite computations × ~90 flops = negligible. Doesn't degrade with sim time, buffered timesteps, or chunk size.

### Phase 1 tests — `chunkBuffer.test.ts`

- `readBodyPositionInto` at integer index returns p_i exactly (regression-protects the s=0 fast path).
- `readBodyPositionInto` at integer + 0.5 with synthetic two-keyframe buffer (known p0, v0, p1, v1, dt) returns the analytical Hermite midpoint.
- `readBodyStateInto` at integer keyframe returns stored velocity exactly.
- `readBodyStateInto` at integer + 0.5 returns the Hermite analytic-derivative velocity.
- Hermite endpoints check: at floatIdx=0 returns p0 + v0; at floatIdx=1 returns p1 + v1.
- Boundary clamping: floatIdx > `totalTimesteps - 1` → returns last keyframe values; floatIdx < 0 → returns first.
- Single-keyframe buffer: falls back gracefully to that keyframe's position + velocity (no Hermite, no out-of-bounds reads).

### Phase 1 verify criterion

- Animation at speedMultiplier=1 visibly smoother — no per-step stutter, motion appears continuous between integration samples.
- Total wall-clock time to play one chunk unchanged.
- Steady-state FPS (Stats.js or DevPanel readout) shows no measurable drop vs. master under the same scene + body count.
- Scrubber, scene-click, focus, orbit-path, and trail rendering all behave identically to master.

## Phase 2 — Backend keyframe thinning

### DTO change — `SimulationRequestDTO.java`

Add `keyframeIntervalSec` (optional, nullable Double). Set once per session at simulation creation; applies to all chunks of that session. `SimulationChunkRequest` is unchanged (server already has the value from the original DTO).

```java
public record SimulationRequestDTO(
    List<String> celestialBodyNames,
    String date,
    String frame,
    String integrator,
    String timeStepUnit,
    Double keyframeIntervalSec  // null → server defaults to stepDt (no thinning)
) {}
```

### Backend resolution

Compute once at simulation construction:

```
K = max(1, round(keyframeIntervalSec / stepDtSeconds))
```

Store on `Simulation` as `final int keyframesPerKept`. If `keyframeIntervalSec` is null, K = 1.

Validation in service layer (not in the integrator hot path):

- `1 <= K <= MAX_K` where `MAX_K = 100` (with default CHUNK_SIZE=10000, this leaves at least 100 keyframes per chunk — visual smoothness floor).
- Reject with HTTP 400 if out of range.
- API contract documents that `keyframeIntervalSec` may be rounded to the nearest integer multiple of stepDt.

### `Simulation.run()` change

Track a global step counter that persists across `run()` invocations, so chunk boundaries don't reset the modulo and produce visible gaps:

```java
private long globalStepCount = 0;       // monotonic across all chunks
private long nextKeptAtStep = 0;        // next global step to emit

public Map<...> run() {
    ...
    if (!hasEmittedInitialFrame) {
        results.put(simCurrentDate, snapshotFromState());  // step 0 always kept
        hasEmittedInitialFrame = true;
        nextKeptAtStep = keyframesPerKept;
    }

    int currentTimeStep = 0;
    while (currentTimeStep < TIMESTEPS_TO_RUN) {
        update();
        globalStepCount++;
        if (globalStepCount >= nextKeptAtStep) {
            results.put(simCurrentDate, snapshotFromState());
            nextKeptAtStep += keyframesPerKept;
        }
        currentTimeStep++;
    }
    ...
}
```

This guarantees uniform K-step spacing across all chunks: the next chunk's first kept keyframe is exactly K steps after the previous chunk's last kept keyframe. No visible gap or stutter at boundaries.

### Hot-path discipline (per `backend-sim-step.md`)

- The K=1 fast path must not regress (default behavior). The `if (globalStepCount >= nextKeptAtStep)` is a single integer comparison; with K=1 it's true every step → identical to today.
- `snapshotFromState()` unchanged. With K=4, snapshot allocation pressure drops 75% (snapshots only constructed for kept steps).
- No collection pre-sizing change needed (`LinkedHashMap` sizes itself to insertions).

### Wire format

**Zero changes.** With K=4, the `timestepCount` header field is ~2500 instead of ~10000, and per-step timestamps are spaced K·stepDt apart. Frontend reconstructs Hermite intervals from those timestamps directly.

### Frontend changes (Phase 2 only)

- Add `keyframeIntervalSec` to the SimRequest builder/types.
- Default value: `stepDt` (no behavior change). Per-integrator defaults arrive in Phase 3.
- No UI surface yet.
- chunkBuffer code already handles non-uniform timestamps correctly (Phase 1's Hermite uses per-keyframe timestamps for `dt`).

### Phase 2 tests

- **Backend `SimulationTest`:**
  - K=1 emits 10001 kept frames per first chunk (initial + 10000 steps).
  - K=4 emits 2501 kept frames per first chunk (initial + steps 4, 8, ..., 10000).
  - K=8 emits 1251 kept frames per first chunk.
  - Cross-chunk continuity: run two consecutive chunks at K=4; assert the second chunk's first kept keyframe is exactly K-spaced from the first chunk's last (no boundary gap).
  - Edge: validate K > TIMESTEPS_TO_RUN behavior. Service-layer validation should prevent it; document expected fallback if it slips through.
- **Service-layer test:** validation rejects K < 1 and K > MAX_K with HTTP 400.
- **`BinaryResponseSerializerTest`:** unchanged (format identical). Optional integration test that decodes a thinned chunk end-to-end.
- **Frontend SimRequest test:** `keyframeIntervalSec` is included in the request body when set.

### Phase 2 verify criterion

- `keyframeIntervalSec = stepDt` (or omitted) → identical chunk size + identical playback as before this PR.
- `keyframeIntervalSec = 4·stepDt` → ~75% smaller compressed chunks; visual playback indistinguishable from K=1 (Hermite working as designed).
- Two consecutive chunks at K=4 show no visual stutter at the boundary.

## Phase 3 — UI surface

### Constants — new `PlaybackQuality.ts` under `frontend/src/app/constants/`

```ts
export const PLAYBACK_QUALITY_PRESETS = {
  high:    { multiplier: 1,  label: "High" },
  medHigh: { multiplier: 2,  label: "Med-High" },
  medium:  { multiplier: 4,  label: "Medium" },
  medLow:  { multiplier: 8,  label: "Med-Low" },
  low:     { multiplier: 16, label: "Low" },
} as const;

export type PlaybackQualityKey = keyof typeof PLAYBACK_QUALITY_PRESETS;

export const INTEGRATOR_QUALITY_DEFAULTS: Record<string, PlaybackQualityKey> = {
  euler:  "high",      // K=1, no thinning — Euler is already crude
  rk4:    "medium",    // K=4
  dp853:  "medLow",    // K=8 — smooth orbits over-sampled, can thin aggressively
};
```

The "× stepDt" framing is internal; user sees only labels + a custom input.

### UI control — `SimSetupDrawer.tsx`

New form field "**Playback quality**" sits under integrator + timeStepUnit (the existing pattern). Two-part control:

- **Segmented radio** with 5 preset buttons (Low / Med-Low / Medium / Med-High / High) — Radix `RadioGroup` styled as a segmented control. Selecting a preset sets the multiplier; visually highlights that segment.
- **"Custom" numeric input** below the segmented control — labeled "Custom keyframe interval (× step)". Accepts integer 1–100. When the value matches a preset, that preset highlights; when it doesn't, no preset is highlighted ("custom" state implicit).

Local state in SimSetupDrawer:

```ts
const [qualityMultiplier, setQualityMultiplier] = useState<number>(
  PLAYBACK_QUALITY_PRESETS[INTEGRATOR_QUALITY_DEFAULTS[integrator]].multiplier
);
```

On integrator change, reset `qualityMultiplier` to the new integrator's default. Simple model — discards any custom value the user typed before changing integrator. The "sticky override" pattern (preserve custom across integrator change) is a friendliness polish, **flagged as optional follow-up.**

### Validation in form

- Custom input clamped to `[1, 100]` (matches backend MAX_K).
- Inline error text under the input if user types something out of range. Submit button disabled while invalid.

### Wire-up to SimRequest

On submit, compute:

```
keyframeIntervalSec = qualityMultiplier · stepDtSeconds(timeStepUnit)
```

Include in the `SimulationRequestDTO`. Existing payload-building logic (around line 75 of `SimSetupDrawer`) gets one more field.

### Tooltip / explainer

Small info icon next to the field. Tooltip copy: "Lower quality ships fewer keyframes — smaller payloads, smoother bandwidth, but motion between samples is interpolated. Higher quality ships every step." Portfolio-readable.

### State persistence

Per-session only — re-derived from integrator default on each new sim setup. No localStorage. (If the redesign later persists SimParams across reloads, quality follows along automatically.)

### Phase 3 tests

- **SimSetupDrawer integration test:**
  - Changing integrator updates the quality preset to the new default.
  - Selecting a preset updates `qualityMultiplier`.
  - Custom input outside [1, 100] shows validation error.
- **Constants test:** every integrator key in `INTEGRATOR_QUALITY_DEFAULTS` is a valid preset key (compile-safe with TS, but a runtime smoke test catches typos).
- **End-to-end manual check:** open SimSetupDrawer → switch integrators → observe preset auto-changes → submit with custom value → confirm payload size in DevTools matches expected ratio.

### Phase 3 verify criterion

- Default-flow user opens drawer → sees the new control → submits without touching it → gets per-integrator default N → backend ships thinned chunks → playback indistinguishable from current.
- Power user picks "Low" or types custom → backend ships much smaller chunks → playback still smooth, payload reduction visible in DevTools network tab.
- Switching integrator pre-submit → preset auto-updates to that integrator's default.

## Risks and open questions

- **Visual quality at high K on Euler/RK4.** Cubic interpolation of crude integration is still crude. Per-integrator defaults guard against accidentally pairing aggressive thinning with crude integration. Power users can still override; the result is "your call." Mitigation: tooltip copy makes the tradeoff explicit.
- **Trail head appearance at fractional index.** Trail tail uses integer past-keyframes; head uses fractional Hermite. Visual continuity at the head/tail join needs verification — should be seamless because the tail's last point IS the keyframe that the Hermite curve passes through exactly at integer index, but worth a manual check during Phase 1 verification.
- **AnimationController offender cleanup** is bundled into Phase 1 to reduce file churn. If it expands scope unexpectedly, split it back out as a follow-up.
- **`Camera.tsx` per-frame allocation** is also bundled into Phase 1 opportunistically. Same scope-creep watch.
- **Sticky-override UX** in Phase 3 (preserving custom value across integrator change) is deferred. If users complain, file as follow-up.

## Test summary

| Phase | New test files / additions |
|---|---|
| 1 | `chunkBuffer.test.ts` — Hermite read functions (8 cases). Manual: smoothness verification, FPS check. |
| 2 | `SimulationTest` (backend) — K=1, K=4, K=8 keyframe counts; cross-chunk continuity. Service-layer validation test. Frontend SimRequest serialization test. |
| 3 | `SimSetupDrawer` integration — preset selection, integrator-change reset, custom input validation. Constants smoke test. Manual: end-to-end DevTools payload-size check. |

## Cross-references

- `todo.md` #20 — this work.
- `todo.md` #37 — orthogonal future bandwidth lever (Float32 quantization, delta encoding).
- `todo.md` #68 — depends on this; exposes DP853's native adaptive substeps via the `StepHandler` API once per-keyframe-timestamp infrastructure lands here.
- `ARCHITECTURE.md` — should gain a section under "Resolved design decisions" once Phase 3 ships, summarizing the per-keyframe-timestamps + Hermite contract for future readers.
- Hot-path rules: `.claude/rules/frontend-render-loop.md`, `.claude/rules/backend-sim-step.md`.
