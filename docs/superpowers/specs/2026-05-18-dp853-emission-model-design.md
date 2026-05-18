# DP853 chunk-emission model

**Date:** 2026-05-18
**Status:** Implemented (Phases 1–3 landed as PRs #14 / #15 / pending Phase 3)
**Tracker entry:** `todo.md` #69 (emission-mode design) — feeds #37 (per-chunk bandwidth)
**Related:** `todo.md` #37, `2026-05-15-hermite-keyframe-interpolation-design.md`, [#13](https://github.com/byeonkho/spacesim/pull/13)
**Companion data:** `ChunkSizeBenchmark.java` (run with `./mvnw test -Dtest=ChunkSizeBenchmark -Dchunk.benchmark=true`)

## Summary

DP853 default settings emit ~41000 snapshots per chunk for a 10-body solar system over 10000 hours — **2× past the current `MAX_SNAPSHOTS_PER_CHUNK = 20000` budget**, throwing `ChunkSnapshotBudgetExceededException` at user-default fidelity. Beyond the budget exception, the resulting ~16 MB compressed chunks are ~16× the bandwidth target in #37.

The root cause isn't the budget number — it's the **emission model**. Today DP853 ships every internally-accepted adaptive substep AND its share of the external-step grid keyframes (thinned by K). Substeps alone are ~40000 per chunk and entirely dominate; K barely matters for DP853 bytes (range 16–19 MB across K=1..K=8).

This doc walks through what's happening (ELI5), the three candidate emission models, and recommends **replace-mode with a snapshot budget**.

## ELI5: what the integrator actually does

Think of the simulation as a hiker walking a long trail. The trail is the timeline; "snapshots" are photos along the way that get shipped back to the frontend so it can draw the orbit.

**Fixed-step integrators (Euler, RK4):** disciplined hiker. *"I'll take a photo every 100 meters, no exceptions."* Predictable photo count: trail length ÷ 100m. The user's "Playback quality" setting (K) says "send back every Kth photo" — a clean thinning.

**Adaptive integrator (DP853):** smart hiker who slows down on tricky terrain. *"I default to walking 100m at a time, but if I hit cliffs or a river, I shrink my stride down to 1m until I'm past it — I have to, or I'll fall."* On a flat path she takes 100 photos in 10 km. Going over a mountain pass she might take 500 photos in the same 10 km. The photo count depends on the terrain, not just the trail length.

Today we ship **both sets of photos**: every shrunk-stride photo DP853 took for accuracy reasons, PLUS one photo every 100m × K from the imagined "external" grid. That's the "add-mode" in #69.

The result for our solar-system benchmark: ~40000 adaptive substep photos + ~1250 external-grid photos at K=8 = **~41250 photos per chunk**. Eight times the snapshots Euler ships at K=1, and the user thinks they picked a "medium fidelity" setting.

## What the wire actually looks like (data)

From `ChunkSizeBenchmark.java`, 10 bodies, hours unit, 10000-hour chunk:

| Scenario             | Snapshots | Raw KB | Zstd KB | Ratio | B/snap·body |
|----------------------|-----------|--------|---------|-------|-------------|
| Euler K=1            | 10001     | 4766   | 4096    | 1.16× | 41.94       |
| RK4 K=4              | 2501      | 1192   | 1027    | 1.16× | 42.05       |
| DP853 K=8 (default!) | 41251     | 19659  | 16396   | 1.20× | 40.70       |
| DP853 K=4            | 42501     | 20254  | 16751   | 1.21× | 40.36       |
| DP853 K=1 (stress)   | 50001     | 23828  | 19160   | 1.24× | 39.24       |

Two findings worth flagging:

1. **Zstd buys almost nothing on this payload (~1.2×).** Float64 mantissas look like noise — there's no structural redundancy to compress. The `SimulationLimits` docstring's implicit ~3–4× ratio assumption is wrong. Implication: format-level redundancy (delta encoding, #37 option B) would actually compress; raw quantization (float32, #37 option A) is a clean ~2× absolute win but doesn't change the order of magnitude.

2. **K barely affects DP853 bytes.** Substeps dominate (~40000) across all K, because K only thins the external-grid layer that's added on top. The user's fidelity slider has essentially no bandwidth effect on DP853 today.

## The three candidate emission models

### Mode A — Add (current)

```
emitted = adaptive_substeps_all + external_step_keyframes[every Kth]
```

- **Pro:** K's user-facing meaning is uniform across integrators ("send every Kth regular step"). Substep capture preserves the integrator's adaptive density signal — Hermite interpolation has the densest sampling exactly where DP853 needed accuracy.
- **Con:** Bytes per chunk are integrator-controlled, not user-controlled. K is a near-no-op for DP853. 16+ MB chunks at the default. Throws the budget exception today.

### Mode B — Replace (substeps replace external grid for DP853)

```
DP853:       emitted = adaptive_substeps[every Kth]
Euler / RK4: emitted = external_step_keyframes[every Kth]   (unchanged)
```

- **Pro:** Bytes scale with K for DP853 too. K=1 ≈ 40000 snapshots (~16 MB), K=8 ≈ 5000 (~2 MB), K=32 ≈ 1250 (~0.5 MB). The user's fidelity slider becomes meaningful for DP853 bandwidth.
- **Con:** K's meaning splits across integrators ("every Kth external step" vs "every Kth adaptive step"). Worse: **uniform-K thinning destroys the adaptive density signal**. If DP853 shrunk its stride 50× during a close approach to integrate accurately, we'd thin those tight substeps the same way as the rest — losing exactly the resolution DP853 paid CPU to produce. Hermite quality drops noticeably near close approaches at high K.

### Mode C — Replace + snapshot budget (recommended)

```
DP853:       emitted = adaptive_substeps thinned non-uniformly to ≤ N
Euler / RK4: unchanged
```

The user picks a "Playback quality" preset that maps to a **target snapshot count** N (say 1k / 2.5k / 5k / 10k per chunk). The backend keeps every Nth substep — except where DP853 took rapid bursts of tiny steps, where it keeps more. Two viable thinning strategies:

- **Time-gap thinning:** capture a substep when cumulative time since last capture exceeds `chunk_duration / N`. Naturally produces denser samples in regions where DP853 took many small steps in a row (because more of those small steps cross any given time threshold). Cheap, deterministic.
- **Importance-weighted thinning:** rank substeps by `1 / step_size_taken` (or local error estimate, which DP853 already computes), keep the top N. More accurate density-preservation but pricier to compute and harder to reason about cross-chunk.

Either way, the user contract becomes "what payload size do you want," not "what's K." K stays as the user-facing fidelity slider for Euler/RK4 (where it still means "every Kth regular step"). Bandwidth bound becomes a backend-enforced cap, not an emergent property.

- **Pro:** Bounded payload regardless of integrator or scenario chaoticness. Preserves adaptive density (more samples where DP853 cared more). One snapshot-budget number is a defensible thing to size against the wire-size target. Removes the integrator-coupling from `MAX_SNAPSHOTS_PER_CHUNK` — the budget becomes the contract, not a safety throw.
- **Con:** Most implementation work — non-uniform thinning logic + new request param + UI changes. Per-chunk snapshot count is no longer a function of (integrator, K) alone — slightly less predictable for tests.

## Hermite reconstruction — why this constraint matters

The frontend uses cubic Hermite interpolation between samples (per `2026-05-15-hermite-keyframe-interpolation-design.md`). Hermite quality is **density-sensitive**: cubic between two samples is exact only if motion is locally cubic. Near a close approach, position can change non-cubically over 30 minutes; if we have samples only every 8 hours there, the interpolated trail will visibly cut the corner.

This is the deciding factor for Mode B vs Mode C:
- Mode B with uniform-K thinning: thins close-approach substeps the same as cruise substeps. Trail quality degrades visibly near close approaches at high K.
- Mode C (time-gap or importance-weighted): preserves the density signal. Trail quality degrades smoothly with N, with no per-event cliffs.

Reality drift (#39 in todo) and integrator residuals (#60) both display visible-quality diagnostics — they'll specifically expose any close-approach quality loss. Mode C is the right play if we want those features to read honest.

## Decisions (finalized 2026-05-18)

### Two-tier wire-size ceiling

DP853 is treated as an **opt-in heavier tier** — discoverable feature for users who want adaptive accuracy and are willing to pay the bandwidth. Default flows land on Euler/RK4.

| Tier | Wire-size ceiling (highest preset) | Snapshot ceiling (today) | With float32 |
|---|---|---|---|
| Default (Euler / RK4) | 2 MB compressed | ~5000 | ~1 MB |
| DP853 (opt-in) | 6 MB compressed | ~15000 | ~3 MB |

Math: ~40 B compressed per snapshot·body × 10 bodies × N snapshots ≈ 400 B × N bytes compressed.

### Preset map (5 buckets, matches existing Hermite UI)

| Bucket | Euler / RK4 | DP853 |
|---|---|---|
| 1 (Lowest) | K=20 → ~500 snap (~0.2 MB) | N=3000 (~1.2 MB) |
| 2 | K=10 → ~1000 (~0.4 MB) | N=5000 (~2 MB) |
| 3 (Med) | K=5 → ~2000 (~0.8 MB) | N=7500 (~3 MB) |
| 4 | K=2 → ~5000 (~2 MB) | N=10000 (~4 MB) |
| 5 (Highest) | K=1 → ~10000 (~4 MB → 2 MB float32) | N=15000 (~6 MB → 3 MB float32) |

### Landing defaults (per-integrator first-load preset)

- **Euler** → bucket 4 (K=2, ~2 MB). Bumped from today's K=1 to fit the 2 MB ceiling pre-float32.
- **RK4** → bucket 3 (K=5, ~0.8 MB). Slightly tighter than today's K=4 for headroom.
- **DP853** → bucket 2 (N=5000, ~2 MB). Same ceiling as fixed-step defaults; reward for opting deeper into DP853 is moving up the slider.

### Thinning algorithm

**Time-gap with drift-free targeting.** Track the next scheduled emission target as an `AbsoluteDate`. Initialise to `simStartDate + targetGapSeconds` immediately after the initial-frame emission. On each candidate (substep callback OR external-step boundary): if candidate ≥ next target, emit at candidate and advance target by exactly `targetGapSeconds` (regardless of how far past the target the actual emission landed). Cross-chunk continuity: the target survives across `run()` invocations so chunk N+1's first emission lands at the natural gap-tick after chunk N's last.

**Drift-free vs drift-prone.** The naive formulation (`lastEmitTime + gap` as the threshold) accumulates "how far past the threshold each emission landed" as cumulative schedule lag. For DP853 with sub-day substep cadence and gaps of several days, this drift adds up to ~7–8% under-count by chunk end. The drift-free formulation walks the target by exactly `gap` each tick — so actual emission count over a chunk is within ≪1% of N. Empirically: N=5000 → 4999 actual; N=10000 → 10000 actual; N=15000 → 14999 actual.

**On density preservation.** Time-gap thinning produces **approximately uniform-time** samples — not adaptive-density-preserving. In both benign and stiff regions, you get ~1 emission per `targetGapSeconds` of sim-time; the difference is just *which* substep gets picked (in stiff regions, more candidate substeps are near the threshold, so the chosen one lands closer to it). This is acceptable because:
- Euler/RK4 already produce uniform-time samples; visualisation at those settings is fine.
- DP853's *integration* accuracy is preserved — adaptive substeps still happen internally — only the visual sampling becomes uniform.
- Hermite quality near close approaches under uniform DP853 sampling is no worse than RK4 at the same N today.

Importance-weighted thinning held in reserve — revisit only if real visual quality near close approaches regresses in practice.

### `MAX_SNAPSHOTS_PER_CHUNK` deleted

With time-gap thinning the budget IS the cap, enforced by construction. Three things removed:
1. `MAX_SNAPSHOTS_PER_CHUNK` constant in `SimulationLimits.java`
2. `ChunkSnapshotBudgetExceededException` class
3. The throw site in `Simulation.run()` + the test-only `maxSnapshotsPerChunk` overload in `SimulationFactory.createSimulation()`

A "much larger safety net" would be unhit dead code. If time-gap thinning ever miscounts, we want the bug visible, not silently caught one threshold up.

### Request API unified

Replace the current `keyframesPerKept` request param with a single `fidelityBucket` enum (1–5) that the backend resolves per-integrator at `/initialize`. Cleaner contract; client doesn't need to know whether the integrator is fixed-step or adaptive. Backwards compat: no persisted sessions (idle-timeout sweeper at 15 min) — wire-param break is free.

### Bundled with float32 in Phase 1

Float32 quantization (#37 option A) lands in the same rollout window as Mode C. Bundling them means we ship one coherent "chunks are bounded now" change rather than two phases where day-one numbers don't quite hit target (Euler K=1 ships at 4 MB compressed today — over the 2 MB ceiling until float32 lands).

---

## Phased rollout

Three phases, each on its own branch with verify-and-merge gate (per `branch-workflow.md`). Each phase is independently shippable and reversible.

| Phase | Branch | Scope | Verify criterion |
|---|---|---|---|
| 1 | `chunk-float32` | Float32 positions+velocities in wire format. Serializer + parser + two-sided tests updated. Timestamp stays int64, µ stays float64. | ChunkSizeBenchmark shows ~half raw bytes; trail/scene visually unchanged; Keplerian elements display unchanged at the precision the body card renders. |
| 2 | `dp853-time-gap` | Time-gap thinning in Simulation. Delete `MAX_SNAPSHOTS_PER_CHUNK` + exception + test-only overload. Backend internally accepts a `targetSnapshots` (N) param for DP853 (controller wires it from a temporary hardcoded default until Phase 3 surfaces the UI). Cross-chunk continuity via per-session last-emit-time. | ChunkSizeBenchmark with explicit N=5000 / N=10000 / N=15000 hits target snapshot counts ±5%; DP853 default no longer throws; no visible discontinuity in Hermite-interpolated trails across chunk boundaries during scrub. |
| 3 | `fidelity-bucket-api` | Unify request API to `fidelityBucket` enum at `/initialize`. Frontend SimParams slider re-mapped per the preset table. Per-integrator landing defaults wired. Rate-limiter sizing comment updated for the new 6 MB DP853 ceiling. | Switching integrators auto-adjusts slider preset; DevTools chunk size per bucket × integrator matches the table within ±10%; landing defaults match the spec. |

Phase 1 is the most mechanical (the wire-format pin tests give us a tight loop). Phase 2 is the most thinking-heavy (time-gap algorithm + continuity state + Hipparchus substep plumbing). Phase 3 is mostly UI + one DTO change.

After Phase 3 lands, `todo.md` updates:
- **#37** — close. Wire-size target hit via Float32 + Mode C; delta encoding deferred unless future need emerges.
- **#69** — close. Emission model decided + shipped.
- **Rate limiter sizing comment** in `RateLimitFilter.java` — update to reflect new 6 MB DP853 ceiling.

## Open questions (implementation-time, don't block decision)

1. **Hipparchus substep capture mechanism.** Does Mode C's time-gap logic plug into the existing StepHandler interface cleanly, or does substep capture need re-plumbing in `DormandPrince853Step`? Investigate at the start of Phase 2.
2. **Bucket-resolution location.** Resolve `fidelityBucket → K` or `fidelityBucket → N` at the controller boundary (mirrors the current `keyframeIntervalSec → K` resolution) or push it into `SimulationFactory`? Decide during Phase 3.

## Out of scope (followups, not blockers)

- **Delta encoding (#37 option B).** Bigger structural change; only worth doing if Phase 1 + 2 don't hit the target. Current math says they will.
- **Per-tier rate-limit accounting.** Today's rate limiter is bytes-per-IP-per-window agnostic of integrator. Once DP853 is heavier, a fairer model might be "chunks-per-IP-per-window" weighted by tier. Defer until usage data justifies it.
