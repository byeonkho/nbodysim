# Integrator residuals (energy drift + DP853 telemetry)

**Date:** 2026-05-19
**Status:** Design
**Tracker entry:** `todo.md` #60 (redesign Phase 5)
**Related:** `todo.md` #39 (Reality drift overlay — the visual companion to this number); prior wire-format work in `2026-05-18-dp853-emission-model-design.md`

## Summary

Surface the simulation's numerical truthfulness as a visible number. The backend computes total system energy `E = T + U` (kinetic + potential) at each emitted snapshot and ships the relative drift `ΔE/E₀ = (E - E₀)/|E₀|` with each snapshot. For DP853 it also ships two chunk-aggregate values — average accepted step size and accept rate — so the user can see when the adaptive integrator is working hard.

UI surfaces:
- **Top status strip** — small always-on `ΔE/E₀` chip. Reads the value at the currently-played snapshot. Ref-based 5 Hz update (matches `BodyCard`'s pattern of avoiding per-frame React rerenders for high-rate numerics).
- **Body card detail subsection** — `Integrator residual` block under Keplerian elements (placeholder comment already in `BodyCard.tsx`). Same `ΔE/E₀` value, plus two DP853-only rows (avg step, accept rate). Rows for DP853 telemetry are hidden when the integrator is Euler/RK4.

The point is making the difference between integrators legible *immediately*: pick Euler, the number ticks up visibly within sim-days; pick DP853, it stays near machine precision. Today three integrators ship and the difference only shows up after long sim runs as visible orbital drift. This puts the difference on screen as a number.

## ELI5 (kept here so the spec is self-contained)

Gravity conserves energy: a planet trades kinetic ↔ potential as it orbits, but the sum is mathematically constant forever. Real integrators don't get this exactly right — each `dt` step makes tiny rounding mistakes, those accumulate, and the system's total energy drifts away from where it started. Energy gained = orbits spiraling out; energy lost = spiraling in. The simulation is lying, slowly.

`ΔE/E₀` is the lie detector. Typical values: Euler ~`1e-3` (visibly wrong within sim-days), RK4 ~`1e-7` (clean for short runs), DP853 ~`1e-12` (machine precision, indistinguishable from "correct").

DP853 is adaptive: each step it computes the answer twice (8th-order and 5th-order), compares them, and either accepts or halves `dt` and retries. So `avgStepSize` and `acceptRate` tell you how hard it's working: small step + low accept rate = the integrator is grinding through a hard region (close approach, conjunction).

## Decisions (from brainstorming, 2026-05-19)

1. **Energy sampling cadence:** **per snapshot.** Each emitted sample carries `ΔE/E₀`. Lets the top-strip number animate as the timeline plays. Cost is negligible (~0.4% backend overhead, ~20 KB/chunk wire).
2. **DP853 telemetry depth:** **avg step + accept rate, per chunk.** Skip `lastStepError` — would require subclassing Hipparchus internals (`estimateError` is protected). Accept rate is approximated from public `getEvaluations()` and the step-handler call count.
3. **UI placement:** **both top strip and body card detail.** Strip = always-visible ambient indicator; body card = detail subsection with the DP853 rows when applicable. Strip shows only `ΔE/E₀` (one cell, no per-body coupling). Body card subsection mirrors the strip value plus DP853 rows.
4. **`E₀` lifecycle:** computed once at `Simulation` construction from the initial state vector. Stored as a field. Sign convention: `(E - E₀) / |E₀|` — preserves the sign of the drift (positive = energy gained, negative = lost). No recomputation on integrator change (integrator swap mid-session isn't supported).

## Architecture

### Backend

**New utility (called on `the line`, allocation-free):**

```java
// On NBodyDerivatives (it already holds gm[] = G·m, the only mass info needed).
public double totalEnergy(double[] state) { ... }
```

Computes `T + U` from a flat state vector in a single indexed `for` loop:
- `T = 0.5 / G · Σ gm[i] · |v_i|²`
- `U = -1.0 / G · Σ_{i<j} gm[i] · gm[j] / r_ij`

Both terms pull `1/G` out of the inner loop and use `gm[]` rather than raw `m[]` (we'd otherwise need either a parallel masses array or per-call divisions). One pairwise loop, same O(N²) shape as `derivativesInto`. No allocations.

**Simulation changes:**

- Field `double e0` — captured in the constructor from `NBodyDerivatives.totalEnergy(initial.data())`.
- New return type from `run()`: replace `Map<AbsoluteDate, List<CelestialBodySnapshot>>` with a `ChunkResult` record holding:
  - `Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots`
  - `Map<AbsoluteDate, Double> deltaERelative` — parallel keys; populated at every emission
  - `Dp853Telemetry telemetry` — nullable; populated only for DP853 (`avgStepSeconds`, `acceptRate`)
- At each emission site (initial frame, fixed-step keyframe, DP853 interpolator emission), compute `ΔE/E₀` from the state used to build the snapshot, put it in `deltaERelative`.
- For DP853, the `Simulation` accumulates `acceptedStepCount` and `totalAcceptedStepSeconds` via the existing `setSubstepHandler` hook — each substep callback already gives `prevTimeSec` and `currTimeSec`. At `run()` end, also read `hipparchusIntegrator.getEvaluations()` (via a new getter on `DP853Integrator`) for the rejected-step estimate.

**DP853 accept-rate estimation:**

DP853 is 12-stage with FSAL (first-same-as-last), so an accepted step costs 12 derivative evaluations and a rejected step costs the same (the rejection comes after computing the step). Approximation:
- `accepted = handlerCallCount` (substep handler only fires on accepted steps).
- `totalAttempts ≈ getEvaluations() / 12`.
- `acceptRate = accepted / totalAttempts`.

The `/12` is approximate (FSAL reuses one stage, so the true ratio is 12 for the first step and 11 thereafter) but for chunks of ~thousands of steps the error is well under 1%, fine for a display readout. Documented in code.

**Wire format extension:**

Append two fields to the header and one to each per-timestep record. Both sides update in the same change.

```
HEADER (after the per-body mu block, before timestepCount):
  float64 dp853AvgStepSeconds      // NaN if not DP853
  float32 dp853AcceptRate          // NaN if not DP853

PER TIMESTEP (prepended to the existing per-body block, after timestamp):
  float32 deltaERelative           // (E - E₀) / |E₀| at this snapshot
```

Layout cost: 12 bytes per chunk header (one-time) + 4 bytes per snapshot. For a 5000-snapshot DP853 chunk that's ~20 KB extra — ~0.4% of current chunk size. Always written (never conditional) so the parser is branchless on this; `NaN` signals "not applicable" for the DP853 fields when Euler/RK4 ran.

`BinaryResponseSerializer.serialize` signature grows from `(data, muByName)` to take a `ChunkResult` (or its three components — TBD at impl, leaning toward the record for cohesion).

### Frontend

**Wire parsing:**

- `parseBinaryChunk.ts` learns the two new header fields and the per-snapshot float32. Both arms of the file (`parseBinaryChunk` and `parseBinaryChunkToTypedArrays`) are updated.
- New typed-array output: `deltaERelative: Float32Array` (length = `timestepCount`).
- New chunk-level fields on the parsed result: `dp853AvgStepSeconds: number | null`, `dp853AcceptRate: number | null`.

**Buffer + slice:**

- `chunkBuffer.ts` stores the new typed array and chunk-level fields alongside positions/timestamps.
- New reader: `readDeltaERelativeAt(timestepIndex) -> number` parallel to the existing position readers. Imperative — no Redux dispatch.
- Chunk-level DP853 telemetry is exposed via a small selector on the active chunk (changes only on chunk boundary, so a regular `useSelector` is fine).

**UI:**

- `TopStatusStrip.tsx`: add a new `StatusCell` showing `ΔE/E₀: 2.3e-12`. Ref-based 5 Hz tick reading `chunkBuffer.readDeltaERelativeAt(currentTimeStepIndex)`. Format: scientific notation, 1-2 significant figures. (Note: the strip's other cells re-render per frame via `useSelector` on the current timestep; the new cell deliberately uses the body-card pattern instead — same data shape, but we don't want to add another per-frame React subscription that wakes whenever `setCurrentTimeStepIndex` dispatches.)
- `BodyCard.tsx`: add an `Integrator residual` section under the existing Keplerian block (the file already has a comment noting #60 will live here). Three rows:
  - `ΔE / E₀` — same value as the top strip.
  - `Avg step` — chunk-level value, formatted with units (`4.2 h`, `12 min`). Hidden if not DP853.
  - `Accept rate` — chunk-level value, formatted as `94.3%`. Hidden if not DP853.
- Numeric rows use DOM refs, matching the established `BodyCard` pattern (no React rerender on per-frame ticks).

## Data flow

```
Simulation.run() inner loop
  ↓ (at each emission)
NBodyDerivatives.totalEnergy(state) → double E
  ↓
ΔE/E₀ = (E - e0) / |e0| → put in ChunkResult.deltaERelative
  ↓ (at end of run, DP853 only)
acceptedCount, getEvaluations() → ChunkResult.telemetry
  ↓
BinaryResponseSerializer.serialize(chunkResult, muByName) → byte[]
  ↓ (zstd → HTTP → frontend)
parseBinaryChunk → ParsedChunkTypedArrays { ..., deltaERelative, dp853AvgStepSeconds, dp853AcceptRate }
  ↓
chunkBuffer stores typed array + chunk-level fields
  ↓
TopStatusStrip cell + BodyCard subsection read on 5 Hz tick
```

## Hot-path discipline

`NBodyDerivatives.totalEnergy` is on the line — called once per emitted snapshot (~5000 times per DP853 chunk). Rules from the backend hot-path guidance apply:

- No allocations in the inner loop. Single indexed `for` over bodies, single inner indexed `for` for the pairwise term.
- No streams.
- Use the existing `gm[]` array. Don't add a `m[]` parallel — extract `1/G` once outside the loop.
- Same memory-access pattern as `derivativesInto` (read flat state by `base = i * COORDS_PER_BODY`). Cache-friendly.

The frontend additions are *not* on the line: the residual values change at 5 Hz (timestep tick rate, not 60 Hz), reads are imperative via refs, no per-frame allocations.

## Testing

Following the project's testing rule (test where failure would be silent / where there's a non-obvious correctness contract / where two sides must agree):

**New backend tests:**

1. `NBodyDerivativesEnergyTest` — for a known 2-body Kepler orbit, run with each integrator for `K` steps, assert:
   - DP853: `|ΔE/E₀| < 1e-9` over a full orbit (load-bearing — the whole point of DP853).
   - RK4: `|ΔE/E₀| < 1e-4` over a full orbit at default dt.
   - Euler: drift is monotonic and bounded (~`1e-2` for short runs) — assert it's *non-zero* (Euler must drift, that's its character).
2. `Dp853TelemetryTest` — for a benign scenario, assert `acceptRate > 0.9` and `avgStepSize` ≈ requested. For a deliberately hard scenario (close encounter), assert `acceptRate < 0.7`.
3. Extend `BinaryResponseSerializerTest` — pin the new wire-format layout. This is the canonical "wire format pinned by both sides" test from the project's testing rule.

**New frontend tests:**

1. Extend `parseBinaryChunk.test.ts` — fixture bytes including the new fields. Verify parser produces the expected `deltaERelative` array and chunk-level fields. Same fixture should match what `BinaryResponseSerializerTest` produces (cross-language contract).
2. `chunkBuffer.test.ts` — `readDeltaERelativeAt` returns correct value at given timestep index across the buffered range.

**Skipped (per testing rule):**

- React rendering of the new rows — visual / interactive, person looking at the screen is a better oracle.
- The `BodyCard` ref-update plumbing — same pattern as existing rows, failures would be loud (`null` ref crash) or obvious (number doesn't update).

## Implementation phases (for writing-plans)

Phased per byeon's branch-workflow rule — each phase ends with explicit-verification gate before merge:

1. **Backend energy calc + ChunkResult.** `NBodyDerivatives.totalEnergy`, `Simulation` returns `ChunkResult` with `deltaERelative`. No DP853 telemetry yet. Unit tests for energy invariance per integrator. **Verify:** energy invariance tests pass; existing simulation tests still pass.
2. **Backend DP853 telemetry.** `Simulation` accumulates accepted-step count and total step duration; `DP853Integrator` exposes `getEvaluations()` getter. `ChunkResult.telemetry` populated for DP853, null otherwise. **Verify:** new `Dp853TelemetryTest` passes; existing tests still pass.
3. **Wire format extension.** Update `BinaryResponseSerializer` and `parseBinaryChunk.ts` together. Extend the cross-side pin tests. **Verify:** both wire tests pass; full chunk roundtrip works in a manual smoke.
4. **Frontend storage + reader.** `chunkBuffer` stores `deltaERelative` typed array + chunk telemetry; `readDeltaERelativeAt` reader. **Verify:** `chunkBuffer.test.ts` passes; manual `console.log` from a dev panel shows reasonable values flowing.
5. **UI surfaces.** `TopStatusStrip` cell, `BodyCard` subsection. **Verify:** manual browser check — pick Euler, watch the number tick up over a sim-week; pick DP853, watch it stay near `1e-12`. Switch between bodies; switch integrators; confirm DP853 rows hide for Euler/RK4.

Each phase is a single commit (or a small handful) on a `integrator-residuals` branch. byeon's per-phase verification gate before merging to master.

## Risks / open questions

- **`getEvaluations()` is on `AbstractIntegrator` in Hipparchus** — verified accessible. Need to expose via `DP853Integrator.getEvaluationCount()` (otherwise `Simulation` would have to reach into Hipparchus internals directly, which violates the integrator interface boundary).
- **Accept rate approximation accuracy.** The `/12` divisor for FSAL is an approximation. If users squint and report misleading values during demos, we could:
  - Switch to a Hipparchus subclass that counts rejections explicitly (extra code surface).
  - Caveat the displayed value (`~94%` instead of `94.3%`).
  - Leave it — the qualitative signal (high vs low) is what matters, not the second decimal.
  Defer the call to phase 2.
- **E₀ for a 0-energy degenerate case** — if `E₀ ≈ 0` somehow (extremely unlikely for any real scenario; total energy of a bound system is strictly negative), `(E - E₀) / |E₀|` blows up. Guard with `|E₀| < ε ? 0 : (E - E₀) / |E₀|` and document the guard in code.
