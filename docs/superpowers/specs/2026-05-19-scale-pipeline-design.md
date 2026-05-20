# Scale pipeline — true LIN / LOG presets

**Date:** 2026-05-19
**Status:** Design (open decisions inline — see "Decisions to resolve")
**Tracker entry:** `todo.md` #61 (redesign Phase 9)
**Related:** prior scale-audit notes captured in #61's bullets

## Summary

Replace the current `SEMI_REALISTIC` ↔ `REALISTIC` toggle with a true Realistic ↔ Log toggle backed by explicit pipeline functions (`worldDistance(r)`, `worldRadius(R)`, `worldDistanceFromParent(...)`). Realistic stays linear and physically accurate (rename only). Log applies real logarithmic compression to radial distance plus a clickability floor on body radii, so the entire solar system fits in a single comfortable viewport with every planet meaningfully separated and clickable.

Drops the global `positionScale` / `radiusScale` knobs in favour of preset-aware pipeline functions. Generalizes the per-body Moon `×15` exception into an in-pipeline minimum-separation rule for child bodies.

## ELI5 (self-contained context)

The simulation has two real problems with how it shows scale:

1. **Realistic is too truthful to look at.** At physical scale, Neptune is 30× further from the Sun than Earth is, and the Sun is 200× smaller than the closest planet's orbit radius. You either zoom way out and see dots, or zoom in and only see one body. Both are bad for "look at the whole system."

2. **Semi-Realistic is silently lying.** It compresses distances 40× more than it compresses body sizes, so the Sun looks ~40× too fat relative to Mercury's orbit. The Moon needed a manual `×15` patch just to not skim Earth's atmosphere. The toggle in the UI says "LIN / LOG" but it's actually "linear / different-linear."

The fix: make Realistic stay physically accurate (it's a useful truth-reference), and replace Semi-Realistic with a true logarithmic preset where outer planets are visually closer to inner ones than reality (because log compresses big numbers more than small ones), but every body is still visible and clickable.

Concretely: Realistic preserves Mercury:Neptune distance ratio at 1:75. Log compresses that to ~1:10 by squashing the big numbers more than the small ones. The Sun, Earth, and Neptune are all clearly visible in the same viewport without zooming.

## Decisions (resolved + remaining)

D5/D6/D7 resolved in design review (2026-05-19): plain-English toggle label, Realistic also goes through the pipeline (single function, two configs), third "Cartoon" preset deferred.

D1/D2/D3 (the numeric knobs) are deferred to playtest with a dev tuner (see D9 below). Defaults shipped in production will be whatever byeon picks after tuning live.

### D1. Log compression curve

Proposed: `worldDistance(r) = A · log10(1 + r / r_ref)` with `r_ref = 1 AU`.

Why this form (`log1p`) over a pure `log`:
- Smooth at `r = 0` (no piecewise, no singularity, no edge case for the Sun)
- In the near field (`r << r_ref`) it's approximately linear, which behaves intuitively for satellite-around-planet distances
- In the far field (`r >> r_ref`) it's logarithmic, which is what we want for outer planets
- One free parameter (`A`), one anchor (`r_ref`)

With `A = 60`, anchor `r_ref = 1 AU`, the planets land at:

| Body | r (AU) | World units |
|------|--------|-------------|
| Mercury | 0.4 | 8.8 |
| Venus | 0.7 | 13.8 |
| Earth | 1.0 | 18.1 |
| Mars | 1.5 | 23.9 |
| Jupiter | 5.2 | 47.5 |
| Saturn | 9.5 | 61.2 |
| Uranus | 19.2 | 78.4 |
| Neptune | 30 | 89.5 |

Total system extent ~90 wu. Every planet has clear visual separation. The exact `A` is tunable in playtest; this proposal is a starting point I think reads well.

**Alternative**: pure `log10(r / r_min)` piecewise with linear below `r_min`. Sharper transition, one more parameter to tune. I'd skip it — `log1p` is cleaner.

### D2. Body radius pipeline

Proposed:
- **Realistic preset**: `worldRadius(R) = R / 1e8` (current behavior, no floor — accurate ratios, bodies as dots).
- **Log preset**: `worldRadius(R) = max(R / 1e8, R_floor)` with `R_floor ≈ 0.5 wu`. Sun stays at 7 wu (above floor). Earth, Mercury, Mars etc. all clamp to 0.5 wu — clickable and visible.

This way Realistic remains a pure truth-reference. Log adds the floor only for visibility.

**Alternative**: scale all bodies up uniformly in Log preset (e.g. `R / 5e6` → Earth at 1.3 wu, Sun at 140 wu — but Sun engulfs Mercury). Worse. Stick with the floor approach.

### D3. Moon hack generalization

**RESOLVED:** body-agnostic minimum-separation rule, derived entirely from runtime data. No per-body hardcoding.

Current: per-body `positionScale: 15` on the Moon in `CelestialBodyProperties` + a `scaleDistanceInto` helper that exaggerates parent-relative distance. Moon-specific data carried in the slice.

Replace with `worldDistanceFromParent(r_real, parentWorldRadius, childWorldRadius)`:

```
max(
  worldDistance(r_real),
  parentWorldRadius + childWorldRadius + 2 * childWorldRadius
)
```

The rule fires for **any** body whose `CelestialBodyProperties.orbitingBody` is non-null. If compressed `worldDistance(r_real)` already exceeds the minimum-gap threshold (parent + child + buffer), the rule passes through unchanged. Only kicks in when the child would otherwise visually merge into its parent. Pass-through is the common case for Earth/Mercury/etc. (which have `orbitingBody = "Sun"` and are far enough that the rule never fires).

**Forward-compatibility (per byeon's call-out):** works automatically for any future additional bodies that declare a parent — Phobos/Deimos (Mars), Europa/Io/Ganymede (Jupiter), Titan (Saturn), Charon (Pluto), or custom satellites in user-built three-body scenarios. Zero per-body data required. The rule reads (i) the child's `orbitingBody` field to identify the parent, (ii) parent + child real radii from existing `CelestialBodyProperties`, (iii) the real position vectors from the wire. All already plumbed.

**Out of scope:** binary systems where two bodies of comparable mass orbit a shared barycenter (e.g. Pluto-Charon). The current `orbitingBody` field can't express "we both orbit each other." No special handling planned; the rule treats whichever body has `orbitingBody` set as the child.

**Field cleanup:** per-body `positionScale` field on `CelestialBodyProperties` gets removed (subsumed by the runtime rule). `EXCEPTION_BODIES_POSITION_SCALE` in `SimConstants.ts` also goes away.

### D4. Slice shape

Current `SimulationScale`:
```typescript
{ name, positionScale, radiusScale, EXCEPTION_BODIES_POSITION_SCALE, AXES }
```

Proposed:
```typescript
{ name: "Realistic" | "Log", preset: "realistic" | "log", AXES: { SIZE } }
```

Pipeline functions in `frontend/src/app/utils/scalePipeline.ts` read `preset` and switch on it internally. Scene components stop reading `positionScale` / `radiusScale` directly — they call `worldDistance(r, preset)` and `worldRadius(R, preset)` instead.

`EXCEPTION_BODIES_POSITION_SCALE` goes away (subsumed by `worldDistanceFromParent`).

Per-body `positionScale` field on `CelestialBodyProperties` also goes away.

### D5. Toggle label — RESOLVED: plain English

Switching to plain-English chip values instead of "LIN" / "LOG". Candidate pairs (TBD before Phase 4):
- "Real" / "Spaced"
- "Real" / "Compressed"
- "True" / "Visible"
- "Real" / "Log" (mixed — "Log" is still semi-technical but recognizable)

Final label still open — byeon picks before Phase 4 wires the chip.

### D6. Realistic preset implementation — RESOLVED: option (a)

Realistic also goes through `worldDistance(r, "realistic")` which returns `r / REALISTIC_DIVISOR` (effectively identity-scaled). Single pipeline function, two preset configs. Cleaner test surface, fewer divergent code paths.

### D7. Cartoon / third preset — RESOLVED: deferred

Two presets ship; third can be added later if the Log preset doesn't compress enough.

### D8. Camera bounds

`AXES.SIZE` feeds `CAMERA_MAX_DISTANCE_MULTIPLIER`. Realistic: 80k. Semi-Realistic: 2k.

After log preset (system extent depends on tuned `A`), `AXES.SIZE` for Log will be ~`1.5 × A` (rough rule: half-extent ≈ Neptune's world position ≈ `A × log10(31) ≈ 1.49A`). Realistic stays at 80k. Need to verify the close-up min-distance (`CAMERA_MIN_DISTANCE_MULTIPLIER` × world radius) still works for bodies clamped at the floor — pretty sure it does because the floor is comfortably bigger than the close-up multiplier expects.

### D9. Dev tuner — RESOLVED: ship in Phase 1

Picking final values for `A`, `r_ref`, and `R_floor` from a spreadsheet is fragile. Solution: ship a small dev-only tuner panel that exposes the pipeline params as live sliders. Tuning happens with the scene running; tuned values get baked into `scalePipeline.ts` defaults at the end.

**Mechanics:**
- Pipeline keeps a mutable module-level `logParams` object: `{ A, rRef, radiusFloor }`. Exported `setLogParams(partial)` for the panel; pipeline functions read from this on every call.
- Pipeline reads happen inside `useFrame`, so changes propagate to the next frame with no extra wiring.
- Not in Redux. These are dev knobs, not user preferences.
- Persistence: write to `localStorage` so refreshes don't reset in-flight tuning.

**Panel surface:**
- Floating overlay at a corner of the viewport, only mounted when `process.env.NODE_ENV === 'development'`.
- Three sliders: `A` (10–200), `r_ref` (0.1–10 AU), `R_floor` (0.0–2.0 wu).
- Each slider has its current numeric value next to it.
- A "reset to defaults" button.
- A "copy values" button that copies the current params as a code snippet for pasting into `scalePipeline.ts`.

**Visibility:**
- Floating panel default-hidden, toggled by a keyboard shortcut (`Shift+S` say) or a small dev-only chip in the existing top status strip area.

**Lifecycle:**
- Stays in the codebase post-tuning. Dev-only mount; ships zero bytes in production builds (NODE_ENV-gated tree-shaking).
- Useful for future tuning passes if/when the body list changes.

**Files added:**
- `frontend/src/app/components/dev/ScaleTuner.tsx` (the panel)
- `setLogParams` / `getLogParams` exports in `scalePipeline.ts`
- A `<ScaleTuner />` mount in the main scene shell, gated by `NODE_ENV`.

## Architecture

### New utility: `frontend/src/app/utils/scalePipeline.ts`

```typescript
export type ScalePreset = "realistic" | "log";

// Convert a real heliocentric (or in any frame the snapshot is in)
// distance in metres to world units. Realistic = linear. Log = log1p
// compression centered at r_ref.
export function worldDistance(r_m: number, preset: ScalePreset): number;

// Convert a real body radius in metres to world units. Realistic preserves
// ratios with no floor. Log applies a minimum so small bodies stay
// clickable.
export function worldRadius(R_m: number, preset: ScalePreset): number;

// Compute the rendered position of a child body relative to its parent,
// enforcing a minimum visual gap so the child doesn't merge into the parent.
// Returns the corrected world-space delta to add to parentWorldPos.
export function worldDistanceFromParent(
  childPos_m: Vector3Simple,
  parentPos_m: Vector3Simple,
  parentWorldRadius: number,
  childWorldRadius: number,
  preset: ScalePreset,
  out: Vector3Simple,
): void;
```

All three are pure functions. `worldDistanceFromParent` mutates `out` for hot-path use (matches `subtractInto` / `scaleDistanceInto` conventions in `helpers.tsx`).

Performance: each scene component calls these ~once per frame per body. 9 bodies × `log10` + a few multiplies = trivial cost (sub-microsecond). Safe to use on the line. Hot-path rule check: no allocations (caller-provided `out`), no streams, indexed math.

### Constants (`SimConstants.ts`)

```typescript
SCALE: {
  REALISTIC: { name: "Realistic", preset: "realistic", AXES: { SIZE: 80_000 } },
  LOG:       { name: "Log",       preset: "log",       AXES: { SIZE: 150 } },
}
```

Plus internal pipeline constants (in `scalePipeline.ts`, not exported as scene-facing):
```typescript
const LOG_A = 60;
const LOG_R_REF_M = 149_597_870_700; // 1 AU
const REALISTIC_DIVISOR = 1e8;
const LOG_RADIUS_FLOOR_WU = 0.5;
```

### Slice (`SimulationSlice.ts`)

```typescript
export interface SimulationScale {
  name: string;
  preset: ScalePreset;
  AXES: { SIZE: number };
}
```

`cycleSimulationScale` reducer alternates `REALISTIC` / `LOG`. Per-body `positionScale` field on `CelestialBodyProperties` is removed. Tests for the slice update accordingly.

### Scene call-site migration

Every consumer of `simulationScale.positionScale` and `radiusScale` gets rewritten. Render-loop audit list per the path-scoped rule:

- `Sphere.tsx`: `setBodyWorldPosition` divide → `worldDistance(r, preset)` per axis. Moon path uses `worldDistanceFromParent`.
- `Trail.tsx`: same pattern, applied per trail vertex.
- `Reticle.tsx`: same.
- `GhostLabel.tsx`: same.
- `Camera.tsx`: same (active body world position + close-up min distance).
- `OrbitPath.tsx`: same per ellipse vertex.
- `Scene.tsx`: `props.radius / simulationScale.radiusScale` → `worldRadius(props.radius, preset)`.

`helpers.tsx`:
- `scaleDistanceInto` is removed (subsumed by `worldDistanceFromParent`).
- `subtractInto`, `setBodyWorldPosition` may need signature changes (they currently take a scale divisor; need to take a preset or use the new pipeline). TBD when implementing — they may stay if the pipeline is called *before* them and they just consume world-unit Vector3Simples.

### Wire / store impact

None. Backend still ships positions in metres. Pipeline lives entirely on the frontend. No DTO changes.

## Test plan

### Pipeline functions (`scalePipeline.test.ts`)

Unit tests cover the math contract:
- `worldDistance(0, "realistic") === 0`
- `worldDistance(0, "log") === 0` (log1p property)
- Monotonicity: for `r1 < r2`, `worldDistance(r1, preset) < worldDistance(r2, preset)` in both presets
- Realistic identity at known anchor: `worldDistance(1e8, "realistic") === 1`
- Log known values: `worldDistance(AU_M, "log") ≈ 18.1` (Earth at 1 AU)
- Log behaves linearly in near-field: `worldDistance(0.01 * AU_M, "log") ≈ 0.6` (within tolerance of `60 * 0.01 / ln(10)`)
- `worldRadius` floor in log preset: `worldRadius(small_R, "log") === LOG_RADIUS_FLOOR_WU`
- `worldRadius` no floor in realistic preset: `worldRadius(small_R, "realistic") === small_R / 1e8`
- `worldDistanceFromParent`: minimum-separation enforced when raw compressed distance is below threshold; pass-through when above

### Slice tests

- `cycleSimulationScale` toggles between Realistic and Log
- Initial state is Log (matches current default, just renamed from SEMI_REALISTIC)
- No `positionScale` / `radiusScale` references remain anywhere; TS compile catches that

### Visual regression

- **Realistic preset**: open the scene with the existing solar-system bodies, confirm the visual is identical to today's Realistic (no per-frame visual diff). This is the "we didn't break the truth-reference" check.
- **Log preset**: confirm all planets fit in viewport at default zoom. Sun at center, Mercury through Neptune visible and clickable. Moon orbits Earth with clear visual separation.

I'll run both presets manually in the browser and screenshot before declaring done.

## Migration phases

Suggest splitting into reviewable phases — each phase ends in a working build + green tests, with byeon's verify gate before merging the next.

**Phase 1: pipeline + tuner + tests, no scene wiring yet.**
- Add `scalePipeline.ts` with the three functions, mutable `logParams`, and `setLogParams` / `getLogParams`.
- Add unit tests.
- Add types (`ScalePreset`) and the new constants.
- Add `ScaleTuner.tsx` (dev panel) and mount in the scene shell gated by `NODE_ENV`.
- Nothing in the scene reads from the pipeline yet. Existing toggle still works as today.
- **Tuner does nothing visible at this stage** (scene doesn't read pipeline yet) — that's fine, Phase 3 connects it.

**Phase 2: slice + constants migration.**
- Update `SimulationScale` interface (add `preset`, plan to drop `positionScale`/`radiusScale` in Phase 3 — keep them transitively for now to avoid a giant atomic diff).
- Update `SCALE.REALISTIC` and rename `SEMI_REALISTIC` → `LOG` with the new shape.
- Verify slice tests still green.

**Phase 3: scene migration.**
- Rewrite every consumer (`Sphere`, `Trail`, `Reticle`, `GhostLabel`, `Camera`, `OrbitPath`, `Scene`) to call pipeline functions.
- Drop `positionScale`/`radiusScale` from `SimulationScale`.
- Drop per-body `positionScale` from `CelestialBodyProperties`.
- Drop `scaleDistanceInto` from helpers.
- This is the big diff — but everything before it has been compile-checked and tested, so the risk is contained.

**🎯 Tuning gate (between Phase 3 and Phase 4).** After Phase 3 merges, the scene is fully driven by the pipeline and the tuner sliders work live. Byeon plays with `A`, `r_ref`, `R_floor` until the system reads well. Final values get pasted into `scalePipeline.ts` as the production defaults in Phase 4. No Phase 4 work starts before this is done.

**Phase 4: bake tuned defaults + UI polish.**
- Hard-code the tuned `A`, `r_ref`, `R_floor` values into `scalePipeline.ts`.
- Update Timeline chip wiring + final plain-English label (per D5 decision — byeon picks pair).
- Update tooltip / Info copy if any explains the toggle.
- Sweep `todo.md` and any comments referencing the old preset names.

**Phase 5: visual verify + cleanup.**
- Browser check both presets at the tuned defaults.
- Remove the audit comment in `SimConstants.ts` ("hand-tuned against Sun's rendered radius") — no longer relevant.
- Update ARCHITECTURE.md if a resolved design decision belongs there.
- Dev tuner stays in the codebase (NODE_ENV-gated, zero prod bytes) for future tuning passes.

## Risks

1. **Performance regression on render loop.** Pipeline call per body per frame. Mitigation: pure-function calls with primitive math, no allocations, no streams. Should be sub-microsecond. The render-loop rule list calls out auditing call costs in big-O terms — this is O(1) per body per frame, same as current.

2. **Visual regression in Realistic preset.** This must look pixel-identical to today. Mitigation: explicit unit test for `worldDistance(r, "realistic") === r / 1e8`. If the test passes and Scene calls the pipeline consistently, the visual must match.

3. **Camera bounds wrong in Log preset.** With system extent ~90 wu and `AXES.SIZE = 150`, the camera should comfortably zoom out without clipping the starfield. `CAMERA_MAX_DISTANCE_MULTIPLIER × AXES.SIZE = 5 × 150 = 750 wu`, well under `STARS_RADIUS × 0.9 = 90_000 wu`. Should be fine. Verify in browser.

4. **OrbitPath sampling.** Pre-computed ellipses have many vertices (~64 per orbit). All go through `worldDistance` now. Confirm visual still smooth (it should — log is monotonic and smooth).

5. **Hermite interpolation** runs on positions in raw metres pre-pipeline (Hermite is interpolation, pipeline is rendering). Should be unaffected. Audit confirms.

## Open questions for byeon

All design decisions resolved as of the 2026-05-19 review:

- D5 label → **deferred to Phase 4** (decided at the same time the chip wiring is rewritten)
- D3 minimum-separation rule → confirmed; body-agnostic, works for future satellites
- D1 / D2 numeric defaults → deferred to the tuning gate between Phase 3 and Phase 4

Ready to write the implementation plan.
