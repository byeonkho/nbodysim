# DP853 chunk-emission model

**Date:** 2026-05-18
**Status:** Design — awaiting decision
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

## Recommendation: Mode C (replace + budget)

Concretely:

1. **Wire-size target: 1 MB compressed per chunk** for the user-default preset. Headroom for 2 MB on the highest-fidelity preset; sub-300 KB on the most-aggressive thinning.
2. **Snapshot budget per chunk: ~5000** at the default preset. With ~40 B compressed per snapshot·body × 10 bodies = ~400 B/snapshot compressed × 5000 = **2 MB compressed today**. Combined with float32 (option A from #37, ~2×): **~1 MB compressed**. Hits target.
3. **For Euler/RK4: nothing changes.** Fixed-step, K stays as today. Already within budget.
4. **For DP853: time-gap thinning** as the v1. Cheap, deterministic, preserves density. Revisit importance-weighted if visual quality regresses.
5. **User-facing control:** "Playback quality" slider stays the same in the UI — backend translates the bucket to either K (for fixed-step) or snapshot budget N (for DP853). Slider semantics don't leak the integrator coupling.
6. **`MAX_SNAPSHOTS_PER_CHUNK` becomes a real cap**, not a safety throw — set to N_max (the highest-fidelity preset), and the emission logic enforces it by construction. The exception goes away.

## Open questions

1. **Does Hipparchus expose accepted-substep timestamps + states cleanly through the StepHandler interface we already use, or does substep capture need re-plumbing?** Implementation detail, doesn't change the design — but affects effort estimate for Mode C.
2. **Cross-chunk continuity under non-uniform thinning.** Chunk N+1 needs to dovetail with chunk N for Hermite reconstruction. The current `globalStepCount` cursor preserves this for fixed-step add-mode. Time-gap thinning needs the equivalent: each chunk starts time-gap accounting from the last kept substep of the previous chunk, not from the chunk boundary. Single integer in session state.
3. **Default preset for DP853.** Today's "DP853 default = K=8" picks the per-integrator default in the SimSetupDrawer. Under Mode C, the equivalent is "DP853 default = N=5000 snapshots." Want to ship that as the default, or pick a smaller N to make the bandwidth win more obvious by default?
4. **Backwards compat.** No existing sessions persist across deploys (in-memory only, idle-timeout sweeper), so we can break wire-format request params freely. Worth confirming there are no saved-URL flows that would break.

## Out of scope (followups, not blockers)

- **Float32 quantization (#37 option A).** Orthogonal — applies the same to all emission modes. Lands after Mode C as a clean 2× absolute cut.
- **Delta encoding (#37 option B).** Bigger structural change; only worth doing if Mode C + float32 doesn't hit the target. Current math says they will.
- **Re-sizing the rate limiter.** Today's nominal "4 MB chunk" sizing is wrong even for Euler K=1 (actually 4 MB compressed) and dramatically wrong for DP853 (16+ MB). Update the comment + sizing after Mode C lands and bytes are actually bounded.

## Decision needed

Before implementation:
- (1) Confirm Mode C direction
- (2) Confirm 1 MB compressed wire-size target + 5000-snapshot default budget
- (3) Pick time-gap vs importance-weighted for v1 (recommend time-gap)
- (4) Decide whether `MAX_SNAPSHOTS_PER_CHUNK` should remain a safety floor (set to e.g. 2× N_max) or be deleted entirely once the cap is enforced by construction
