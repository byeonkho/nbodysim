# Scale Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Semi-Realistic ↔ Realistic scale toggle with a true Realistic ↔ Log toggle backed by explicit pipeline functions (`worldDistance`, `worldRadius`, `worldDistanceFromParent`), with live dev-mode sliders for tuning the log-curve params before baking final defaults.

**Architecture:** A pure-function pipeline module (`scalePipeline.ts`) translates real-world metres to world-unit positions and radii. Two presets — Realistic (linear divide) and Log (`log1p` compression with a body-radius floor). The Moon `×15` hack generalises into a body-agnostic minimum-separation rule that works for any future child satellite. Dev-mode tunables (A, r_ref, R_floor) flow through the existing `devSettingsStore` + `DevPanel` infrastructure — no new dev-panel scaffolding needed.

**Tech Stack:** TypeScript, Vitest, React, Redux Toolkit, R3F (three.js).

**Branch:** `scale-pipeline`. Commit freely on the branch; merge to master after Phase 5's byeon-verify gate.

**Spec deviation note:** The spec sketched a pipeline-owned mutable `logParams` + `setLogParams`/`getLogParams`. After auditing existing dev infra, this plan instead uses the existing `frontend/src/app/dev/devSettingsStore.ts` module — same pattern, less duplication. Three new fields (`logScaleA`, `logScaleRRef`, `logRadiusFloor`) get added to `DevSettings`. The pipeline reads from `getDevSettings()` for live values. "Baking final defaults" becomes "updating the `DEFAULTS` constant" — same outcome, no extra abstraction.

---

## File structure

**New files:**
- `frontend/src/app/utils/scalePipeline.ts` — the three pipeline functions + preset configs + tests target
- `frontend/src/app/utils/scalePipeline.test.ts` — unit tests for the math contract

**Modified files (alphabetical):**
- `ARCHITECTURE.md` — resolved design decision entry
- `frontend/src/app/components/chrome/Timeline.tsx` — chip label rewrite (Phase 4)
- `frontend/src/app/components/dev/DevPanel.tsx` — three new SliderRow entries in `<Tunables />`
- `frontend/src/app/components/scene/Camera.tsx` — pipeline migration
- `frontend/src/app/components/scene/GhostLabel.tsx` — pipeline migration
- `frontend/src/app/components/scene/OrbitPath.tsx` — pipeline migration
- `frontend/src/app/components/scene/Reticle.tsx` — pipeline migration
- `frontend/src/app/components/scene/Scene.tsx` — `worldRadius` for body radii
- `frontend/src/app/components/scene/Sphere.tsx` — pipeline migration + Moon rule
- `frontend/src/app/components/scene/Trail.tsx` — pipeline migration
- `frontend/src/app/constants/SimConstants.ts` — drop scale knobs, add `preset` field
- `frontend/src/app/dev/devSettingsStore.ts` — three new fields, defaults
- `frontend/src/app/store/slices/SimulationSlice.middleware.test.ts` — update fixture for new shape
- `frontend/src/app/store/slices/SimulationSlice.test.ts` — update fixture for new shape
- `frontend/src/app/store/slices/SimulationSlice.ts` — `SimulationScale` interface, drop per-body `positionScale`, update `cycleSimulationScale`
- `frontend/src/app/utils/helpers.tsx` — drop `scaleDistanceInto`
- `todo.md` — remove #61 entry post-merge

---

## Phase 1 — Pipeline + dev tunables wiring (no scene changes)

Pipeline functions land with full test coverage. DevPanel grows three sliders. Nothing in the scene consumes the pipeline yet — Realistic and Semi-Realistic still render via `positionScale` / `radiusScale` as before. The sliders move but the scene does not respond. This is intentional: lets us verify the math contract in isolation before wiring it through 7 scene files.

### Task 1.1 — Create branch + scaffolding

**Files:**
- Bash command only (no file edits)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout master
git pull --ff-only
git checkout -b scale-pipeline
```

- [ ] **Step 2: Confirm clean baseline**

```bash
cd frontend && npm run build && npm test
```

Expected: build passes, 141/141 tests pass (baseline from prior session).

### Task 1.2 — Add `ScalePreset` type + skeleton module

**Files:**
- Create: `frontend/src/app/utils/scalePipeline.ts`

- [ ] **Step 1: Write the skeleton module**

```typescript
// frontend/src/app/utils/scalePipeline.ts
//
// Scale pipeline — real metres → world units, per preset. Two presets:
//   - "realistic": linear divide. Bodies are dots, ratios are physically
//     accurate. Truth reference.
//   - "log":      log1p-compressed radial distance + clickability floor on
//     body radii. Whole solar system fits in one viewport with every
//     planet visibly separated.
//
// Both presets go through the same `worldDistance` / `worldRadius` calls;
// the preset arg picks which internal config applies. Realistic is a
// degenerate case (identity-divide, no floor) of the same plumbing.
//
// Log-preset params (A, r_ref, R_floor) are tunable at runtime via the
// dev panel — they live in `devSettingsStore` so the sliders, the
// pipeline, and the test setup all share one source of truth.

import { getDevSettings } from "@/app/dev/devSettingsStore";
import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

export type ScalePreset = "realistic" | "log";

// Realistic preset: every metre divided by this. Identical to current
// `radiusScale = positionScale = 1e8` behavior. Bodies render at
// real_size / 1e8, distances at real_distance / 1e8.
export const REALISTIC_DIVISOR = 1e8;

// Log preset defaults — these are tuning starting points. Final values
// get picked at the post-Phase-3 tuning gate and baked into
// `devSettingsStore.DEFAULTS`. Until then, sliders override these.
export const DEFAULT_LOG_SCALE_A = 60;
export const DEFAULT_LOG_R_REF_M = 149_597_870_700; // 1 AU
export const DEFAULT_LOG_RADIUS_FLOOR_WU = 0.5;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/app/utils/scalePipeline.ts
git commit -m "feat(scale): scaffold scalePipeline.ts with type + defaults

ScalePreset union + Realistic/Log defaults as exported constants.
No pipeline functions yet — landing in subsequent tasks with tests."
```

### Task 1.3 — Add `logScaleA` / `logScaleRRef` / `logRadiusFloor` to `DevSettings`

**Files:**
- Modify: `frontend/src/app/dev/devSettingsStore.ts`

- [ ] **Step 1: Extend the `DevSettings` interface**

Insert after the `skyboxVariant` field (preserve existing JSDoc style):

```typescript
  /**
   * Log preset: overall stretch multiplier on the log curve. Bigger A =
   * larger system in world space; ratios between planet positions are
   * unchanged. See worldDistance() in scalePipeline.ts.
   */
  logScaleA: number;
  /**
   * Log preset: anchor distance (metres) for log1p. Sets where the
   * curve transitions from linear-ish (r << r_ref) to logarithmic
   * (r >> r_ref). Default is 1 AU; smaller values compress outer
   * planets more aggressively.
   */
  logScaleRRef: number;
  /**
   * Log preset: minimum world-unit radius for any body. Real bodies
   * smaller than this clamp up so they stay clickable + visible.
   * Realistic preset ignores this (no floor).
   */
  logRadiusFloor: number;
```

- [ ] **Step 2: Extend `DEFAULTS`**

```typescript
const DEFAULTS: DevSettings = {
  zoomSensitivity: 0.001,
  orbitDampingFactor: 0.01,
  cameraZoomLerpRate: 0.1,
  trailLength: 1000,
  skyboxVariant: "full",
  logScaleA: 60,
  logScaleRRef: 149_597_870_700,
  logRadiusFloor: 0.5,
};
```

- [ ] **Step 3: Verify build + types**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. (`DevPanel.tsx` won't be using these fields yet; the type extension is safe.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/dev/devSettingsStore.ts
git commit -m "feat(dev): add log-scale tunables to DevSettings

logScaleA / logScaleRRef / logRadiusFloor with sensible defaults
(60, 1 AU, 0.5 wu). Wired into DevPanel sliders in a later task."
```

### Task 1.4 — TDD: `worldDistance(r, preset)`

**Files:**
- Create: `frontend/src/app/utils/scalePipeline.test.ts`
- Modify: `frontend/src/app/utils/scalePipeline.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// frontend/src/app/utils/scalePipeline.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  worldDistance,
  REALISTIC_DIVISOR,
  DEFAULT_LOG_SCALE_A,
} from "./scalePipeline";
import { setDevSetting } from "@/app/dev/devSettingsStore";

describe("worldDistance", () => {
  beforeEach(() => {
    // Reset log params to defaults so tests are deterministic.
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
  });

  describe("realistic preset", () => {
    it("returns 0 for r=0", () => {
      expect(worldDistance(0, "realistic")).toBe(0);
    });

    it("divides by REALISTIC_DIVISOR for arbitrary r", () => {
      expect(worldDistance(1e8, "realistic")).toBe(1);
      expect(worldDistance(5e10, "realistic")).toBe(500);
    });

    it("is monotonic", () => {
      const r1 = worldDistance(1e10, "realistic");
      const r2 = worldDistance(2e10, "realistic");
      expect(r2).toBeGreaterThan(r1);
    });
  });

  describe("log preset", () => {
    const AU = 149_597_870_700;

    it("returns 0 for r=0 (log1p property)", () => {
      expect(worldDistance(0, "log")).toBe(0);
    });

    it("places Earth (1 AU) at A * log10(2) ≈ 18.06 wu", () => {
      const expected = DEFAULT_LOG_SCALE_A * Math.log10(2);
      expect(worldDistance(AU, "log")).toBeCloseTo(expected, 5);
    });

    it("places Neptune (30 AU) at A * log10(31) ≈ 89.5 wu", () => {
      const expected = DEFAULT_LOG_SCALE_A * Math.log10(31);
      expect(worldDistance(30 * AU, "log")).toBeCloseTo(expected, 5);
    });

    it("is monotonic", () => {
      const r1 = worldDistance(0.5 * AU, "log");
      const r2 = worldDistance(1.0 * AU, "log");
      const r3 = worldDistance(30 * AU, "log");
      expect(r2).toBeGreaterThan(r1);
      expect(r3).toBeGreaterThan(r2);
    });

    it("responds to live param changes", () => {
      const before = worldDistance(AU, "log");
      setDevSetting("logScaleA", 120); // double A
      const after = worldDistance(AU, "log");
      expect(after).toBeCloseTo(before * 2, 5);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: FAIL — `worldDistance` is not exported.

- [ ] **Step 3: Implement `worldDistance`**

Append to `frontend/src/app/utils/scalePipeline.ts`:

```typescript
/**
 * Convert a real heliocentric distance in metres to world units, per
 * preset. Realistic: linear divide by REALISTIC_DIVISOR. Log: log1p
 * compression with live-tunable A and r_ref from devSettingsStore.
 */
export function worldDistance(r_m: number, preset: ScalePreset): number {
  if (preset === "realistic") {
    return r_m / REALISTIC_DIVISOR;
  }
  // Log preset: A * log10(1 + r / r_ref).
  const { logScaleA, logScaleRRef } = getDevSettings();
  return logScaleA * Math.log10(1 + r_m / logScaleRRef);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: PASS — all `worldDistance` describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/utils/scalePipeline.ts frontend/src/app/utils/scalePipeline.test.ts
git commit -m "feat(scale): add worldDistance(r, preset) with TDD coverage

Realistic = linear divide by 1e8. Log = A * log10(1 + r/r_ref) reading
A and r_ref live from devSettingsStore. Tests cover r=0 edge cases,
monotonicity, known anchor values (Earth/Neptune), and live param
response."
```

### Task 1.5 — TDD: `worldRadius(R, preset)`

**Files:**
- Modify: `frontend/src/app/utils/scalePipeline.test.ts`
- Modify: `frontend/src/app/utils/scalePipeline.ts`

- [ ] **Step 1: Append failing tests**

Add to `scalePipeline.test.ts`:

```typescript
import { worldRadius } from "./scalePipeline";

describe("worldRadius", () => {
  beforeEach(() => {
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
  });

  describe("realistic preset", () => {
    it("divides by REALISTIC_DIVISOR with no floor", () => {
      // Earth radius 6.371e6 m → 0.06371 wu (below 0.5 floor — but no floor in realistic)
      expect(worldRadius(6.371e6, "realistic")).toBeCloseTo(0.06371, 5);
      // Sun radius 6.96e8 m → 6.96 wu
      expect(worldRadius(6.96e8, "realistic")).toBeCloseTo(6.96, 5);
    });

    it("returns 0 for R=0", () => {
      expect(worldRadius(0, "realistic")).toBe(0);
    });
  });

  describe("log preset", () => {
    it("clamps small bodies to logRadiusFloor", () => {
      // Earth (6.371e6 m / 1e8 = 0.064 wu) is below 0.5 floor → clamped
      expect(worldRadius(6.371e6, "log")).toBe(0.5);
      // Mercury (2.44e6 m / 1e8 = 0.024 wu) likewise
      expect(worldRadius(2.44e6, "log")).toBe(0.5);
    });

    it("passes through for bodies above the floor", () => {
      // Sun (6.96e8 m / 1e8 = 6.96 wu) is well above 0.5 floor
      expect(worldRadius(6.96e8, "log")).toBeCloseTo(6.96, 5);
    });

    it("responds to floor changes", () => {
      setDevSetting("logRadiusFloor", 1.0);
      expect(worldRadius(6.371e6, "log")).toBe(1.0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: FAIL — `worldRadius` not exported.

- [ ] **Step 3: Implement `worldRadius`**

Append to `scalePipeline.ts`:

```typescript
/**
 * Convert a real body radius in metres to world units, per preset.
 * Realistic: linear divide, no floor — bodies stay at their truth ratio,
 * which makes most planets dots at default zoom. Log: linear divide
 * clamped to logRadiusFloor so bodies stay visible + clickable.
 */
export function worldRadius(R_m: number, preset: ScalePreset): number {
  const linear = R_m / REALISTIC_DIVISOR;
  if (preset === "realistic") {
    return linear;
  }
  const { logRadiusFloor } = getDevSettings();
  return Math.max(linear, logRadiusFloor);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/utils/scalePipeline.ts frontend/src/app/utils/scalePipeline.test.ts
git commit -m "feat(scale): add worldRadius(R, preset) with floor

Realistic preset returns R/1e8 with no clamping. Log preset clamps to
logRadiusFloor (default 0.5 wu) so small bodies stay clickable and
visible. Tests cover both presets, floor clamping, pass-through, and
live param response."
```

### Task 1.6 — TDD: `worldDistanceFromParent` (Moon-rule generalization)

**Files:**
- Modify: `frontend/src/app/utils/scalePipeline.test.ts`
- Modify: `frontend/src/app/utils/scalePipeline.ts`

- [ ] **Step 1: Append failing tests**

```typescript
import { worldDistanceFromParent } from "./scalePipeline";
import type { Vector3Simple } from "@/app/store/slices/SimulationSlice";

describe("worldDistanceFromParent", () => {
  const AU = 149_597_870_700;
  let out: Vector3Simple;

  beforeEach(() => {
    setDevSetting("logScaleA", DEFAULT_LOG_SCALE_A);
    setDevSetting("logScaleRRef", 149_597_870_700);
    setDevSetting("logRadiusFloor", 0.5);
    out = { x: 0, y: 0, z: 0 };
  });

  it("passes through when child is comfortably outside parent", () => {
    // Earth at 1 AU from Sun, log preset. Sun world radius ~7 wu,
    // Earth world radius 0.5 (floor). Threshold = 7 + 0.5 + 1.0 = 8.5.
    // Earth's worldDistance(1 AU) = ~18 wu > 8.5 → pass through.
    const childPos = { x: AU, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 7.0, 0.5, "log", out);
    // Magnitude should equal worldDistance(AU, "log")
    const expectedMag = DEFAULT_LOG_SCALE_A * Math.log10(2);
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(expectedMag, 5);
  });

  it("enforces minimum separation when child would merge with parent", () => {
    // Moon at ~3.84e8 m from Earth, log preset. Earth world radius 0.5,
    // Moon world radius 0.5. Threshold = 0.5 + 0.5 + 1.0 = 2.0.
    // Moon's worldDistance(3.84e8) = 60 * log10(1 + 3.84e8/1.5e11) ≈ 0.067 wu
    // Below threshold → clamp to 2.0 wu.
    const moonR = 3.84e8;
    const childPos = { x: moonR, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 0.5, 0.5, "log", out);
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(2.0, 5);
  });

  it("preserves direction when clamping", () => {
    // Pure-Y offset child; result should also be along Y.
    const childPos = { x: 0, y: 3.84e8, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 0.5, 0.5, "log", out);
    expect(out.x).toBe(0);
    expect(out.z).toBe(0);
    expect(out.y).toBeGreaterThan(0);
  });

  it("returns zero vector when child overlaps parent exactly", () => {
    // Degenerate case: identical positions. Should not NaN.
    const samePos = { x: 1e10, y: 0, z: 0 };
    worldDistanceFromParent(samePos, samePos, 0.5, 0.5, "log", out);
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
    expect(Number.isFinite(out.z)).toBe(true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it("works in realistic preset too", () => {
    // Earth at 1 AU from Sun, realistic preset. worldDistance(AU) = 1496 wu,
    // way above any threshold → pass through.
    const childPos = { x: AU, y: 0, z: 0 };
    const parentPos = { x: 0, y: 0, z: 0 };
    worldDistanceFromParent(childPos, parentPos, 6.96, 0.064, "realistic", out);
    const expectedMag = AU / REALISTIC_DIVISOR;
    const actualMag = Math.sqrt(out.x ** 2 + out.y ** 2 + out.z ** 2);
    expect(actualMag).toBeCloseTo(expectedMag, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: FAIL — `worldDistanceFromParent` not exported.

- [ ] **Step 3: Implement `worldDistanceFromParent`**

Append to `scalePipeline.ts`:

```typescript
/**
 * Body-agnostic minimum-separation rule for child-of-parent bodies.
 * Writes the rendered world-space delta (child relative to parent) into
 * `out`. If the compressed child-parent distance is comfortably outside
 * the parent's rendered radius, passes through unchanged. If the child
 * would visually merge with its parent, pushes the child out to a
 * comfortable visual gap.
 *
 * Threshold: parentWorldRadius + childWorldRadius + 2 * childWorldRadius.
 * The 2× buffer keeps the child clearly separate from the parent's limb
 * even at oblique camera angles.
 *
 * Direction is preserved by scaling the unit vector from parent → child.
 * Degenerate input (identical positions) writes the zero vector — caller
 * is responsible for handling that case if needed.
 *
 * Mutating-output convention matches helpers.tsx (allocation-free for
 * hot-path useFrame consumers).
 */
export function worldDistanceFromParent(
  childPos_m: Vector3Simple,
  parentPos_m: Vector3Simple,
  parentWorldRadius_wu: number,
  childWorldRadius_wu: number,
  preset: ScalePreset,
  out: Vector3Simple,
): void {
  const dx = childPos_m.x - parentPos_m.x;
  const dy = childPos_m.y - parentPos_m.y;
  const dz = childPos_m.z - parentPos_m.z;
  const r_m = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (r_m === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }

  const compressed = worldDistance(r_m, preset);
  const minGap = parentWorldRadius_wu + childWorldRadius_wu * 3; // child + 2× buffer
  const finalDist = compressed > minGap ? compressed : minGap;

  const scale = finalDist / r_m;
  out.x = dx * scale;
  out.y = dy * scale;
  out.z = dz * scale;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- scalePipeline
```

Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/utils/scalePipeline.ts frontend/src/app/utils/scalePipeline.test.ts
git commit -m "feat(scale): add worldDistanceFromParent minimum-separation rule

Body-agnostic generalization of the Moon ×15 hack. Computes the
rendered world-space delta from parent to child, enforcing a visual
gap of parent_R + 3×child_R. Pass-through for Sun-orbiting bodies
(they're always far enough); clamp for tight satellites (Moon and
any future small moons). Direction-preserving, allocation-free,
NaN-safe for degenerate identical-position input."
```

### Task 1.7 — Wire the three sliders into DevPanel

**Files:**
- Modify: `frontend/src/app/components/dev/DevPanel.tsx`

- [ ] **Step 1: Read the existing `<Tunables />` section to find the right insertion point**

```bash
grep -n "function Tunables\|SliderRow\|valueKey" src/app/components/dev/DevPanel.tsx
```

Use the existing `SliderRow` component pattern. The new section sits below the existing rows.

- [ ] **Step 2: Add three new SliderRow entries**

Inside `<Tunables />` (in `DevPanel.tsx`), append three new rows after the existing tunables. Use the same `SliderRow` pattern that's already in the file — pass `valueKey`, `min`, `max`, `step`, `label`, and a `format` callback for display. The exact `min`/`max` are tuning ranges; we pick wide-enough-to-explore values:

```tsx
{/* Scale pipeline (log preset) — tunable for the visible-system view. */}
<SliderRow
  label="Log A"
  valueKey="logScaleA"
  value={settings.logScaleA}
  min={10}
  max={200}
  step={1}
  format={(v) => v.toFixed(0)}
/>
<SliderRow
  label="Log r_ref"
  valueKey="logScaleRRef"
  value={settings.logScaleRRef}
  min={0.1 * 149_597_870_700}
  max={10 * 149_597_870_700}
  step={0.1 * 149_597_870_700}
  format={(v) => `${(v / 149_597_870_700).toFixed(2)} AU`}
/>
<SliderRow
  label="R floor"
  valueKey="logRadiusFloor"
  value={settings.logRadiusFloor}
  min={0}
  max={2}
  step={0.05}
  format={(v) => `${v.toFixed(2)} wu`}
/>
```

Adjust prop names/order to match the existing `SliderRow` signature in the file. If `SliderRow` doesn't currently accept a `format` callback, either (a) extend the SliderRow component to accept one (preferred — uniform display), or (b) inline the formatting where needed. Pick whichever is the smaller diff.

- [ ] **Step 3: Verify build + lint + dev-mode render**

```bash
cd frontend && npm run build && npm run lint
```

Expected: clean.

```bash
npm run dev
```

Then open `http://localhost:3001/?dev=1` and confirm the three new sliders appear in the Dev panel and dragging them updates the live readout. (Scene won't react yet — that's expected for Phase 1.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/dev/DevPanel.tsx
git commit -m "feat(dev): expose log-scale tunables (A, r_ref, R_floor) in DevPanel

Three new sliders bolted onto the existing Tunables section. Each
slider mutates devSettingsStore, which is what the scale pipeline
reads from. Scene doesn't consume the pipeline yet — sliders are
inert until Phase 3 connects them."
```

### Task 1.8 — Phase 1 verify gate

- [ ] **Step 1: Full verify pass**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: build passes, lint clean, all tests green (141 baseline + new scalePipeline tests = 150+).

- [ ] **Step 2: Surface progress to byeon**

Push the branch, summarize what's landed, and stop. Per branch-workflow rule, no merging until Phase 5.

```bash
git push -u origin scale-pipeline
```

Report to byeon: "Phase 1 complete. Pipeline + dev sliders shipped, tests green. Sliders move but scene doesn't react yet — that's Phase 3. Ready to proceed?"

---

## Phase 2 — Slice migration (additive, scene unchanged)

`SimulationScale` interface grows a `preset` field. `SCALE.SEMI_REALISTIC` renames to `SCALE.LOG` with the new shape. **Old `positionScale` / `radiusScale` / `EXCEPTION_BODIES_POSITION_SCALE` fields are KEPT** so the scene still works — Phase 3 drops them.

### Task 2.1 — Extend `SimulationScale` interface with `preset`

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`

- [ ] **Step 1: Import `ScalePreset` and extend the interface**

In `SimulationSlice.ts`, near the top of the imports:

```typescript
import type { ScalePreset } from "@/app/utils/scalePipeline";
```

Update the `SimulationScale` interface (currently around line 74-83):

```typescript
export interface SimulationScale {
  // set in SimConstants
  name: string;
  preset: ScalePreset;
  // Deprecated — kept for Phase 2 transition. Removed in Phase 3 once
  // all scene consumers are migrated to scalePipeline functions.
  positionScale: number;
  radiusScale: number;
  EXCEPTION_BODIES_POSITION_SCALE: { [bodyName: string]: number };
  AXES: {
    SIZE: number;
  };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Expected: errors at all `SCALE` initializer sites in `SimConstants.ts` (missing `preset` field). Next task fixes those.

### Task 2.2 — Add `preset` to both presets in `SimConstants`

**Files:**
- Modify: `frontend/src/app/constants/SimConstants.ts`

- [ ] **Step 1: Add `preset` field to both presets**

Modify `SimConstants.ts`:

```typescript
  SCALE: {
    SEMI_REALISTIC: {
      name: "Semi-Realistic",
      preset: "log" as const,
      positionScale: 4_000_000_000,
      radiusScale: 100_000_000,
      EXCEPTION_BODIES_POSITION_SCALE: {
        MOON: 15,
      },
      AXES: {
        SIZE: 2_000,
      },
    },
    REALISTIC: {
      name: "Realistic",
      preset: "realistic" as const,
      positionScale: 100_000_000,
      radiusScale: 100_000_000,
      EXCEPTION_BODIES_POSITION_SCALE: {
        MOON: 1,
      },
      AXES: {
        SIZE: 80_000,
      },
    },
  },
```

- [ ] **Step 2: Verify TypeScript + tests**

```bash
cd frontend && npx tsc --noEmit && npm test
```

Expected: clean compile, all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/store/slices/SimulationSlice.ts frontend/src/app/constants/SimConstants.ts
git commit -m "feat(scale): add preset field to SimulationScale (transitional)

SimulationScale gains a 'preset' field of type ScalePreset
('realistic' | 'log'). Both existing presets get the corresponding
value. Old positionScale/radiusScale/EXCEPTION_BODIES_POSITION_SCALE
stay in place — Phase 3 drops them after scene migration."
```

### Task 2.3 — Update slice tests for new shape

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.test.ts`
- Modify: `frontend/src/app/store/slices/SimulationSlice.middleware.test.ts`

- [ ] **Step 1: Verify the test fixtures still compile**

```bash
cd frontend && npm test
```

Expected: tests pass (fixtures use `SimConstants.SCALE.SEMI_REALISTIC` directly, so they automatically pick up the new `preset` field).

If there are any test fixtures that build `SimulationScale` objects literally (not via `SimConstants`), they'll fail to compile. Update them to include `preset: "realistic"` or `preset: "log"` as appropriate.

- [ ] **Step 2: Commit (only if changes were needed)**

```bash
git add frontend/src/app/store/slices/SimulationSlice.test.ts frontend/src/app/store/slices/SimulationSlice.middleware.test.ts
git commit -m "test(scale): update slice test fixtures for preset field"
```

If no changes were needed, skip the commit.

### Task 2.4 — Phase 2 verify gate

- [ ] **Step 1: Full verify pass**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all green.

- [ ] **Step 2: Push and surface progress to byeon**

```bash
git push
```

Report: "Phase 2 complete. Slice interface grew a `preset` field; both presets carry it. Scene unchanged. Phase 3 next — this is the big diff (7 files)."

---

## Phase 3 — Scene migration (the big diff)

Every consumer of `simulationScale.positionScale` / `simulationScale.radiusScale` / per-body `positionScale` migrates to pipeline functions. After this phase, the scene fully consumes the pipeline. Tuner sliders become live.

**Migration pattern (apply per file):**

1. Read `simulationScale.preset` from Redux (most components already pull `simulationScale`).
2. Replace `setBodyWorldPosition(out, simple, simulationScale.positionScale)` with a pipeline-aware variant — see helpers.tsx update in Task 3.1.
3. Replace `radius / simulationScale.radiusScale` with `worldRadius(radius, preset)`.
4. Replace `scaleDistanceInto` for Moon-style cases with `worldDistanceFromParent`.

### Task 3.1 — Add pipeline-aware position helper to helpers.tsx

**Files:**
- Modify: `frontend/src/app/utils/helpers.tsx`

- [ ] **Step 1: Add a new mutating-output helper**

Append to `helpers.tsx`:

```typescript
import {
  worldDistance,
  type ScalePreset,
} from "@/app/utils/scalePipeline";

// Mutating-output: writes the world-space position of a body whose raw
// metres position is in `simple`, using the pipeline `worldDistance`
// for the active preset. Per-axis call because worldDistance compresses
// distance magnitude, not per-axis distance — but for heliocentric
// positions where the origin is the Sun, scaling each axis by
// (worldDistance(r) / r) preserves direction and gives the right
// magnitude. The Y/Z swap mirrors the existing setBodyWorldPosition.
//
// Replaces setBodyWorldPosition(..., positionScale) for non-parent-of
// scenarios. For child-of-parent (Moon-style), use the pipeline's
// worldDistanceFromParent + add to parent's world position.
export function setBodyWorldPositionWithPreset(
  out: { x: number; y: number; z: number },
  simple: Vector3Simple,
  preset: ScalePreset,
): void {
  const r_m = Math.sqrt(
    simple.x * simple.x + simple.y * simple.y + simple.z * simple.z,
  );
  if (r_m === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  const scale = worldDistance(r_m, preset) / r_m;
  out.x = simple.x * scale;
  // Existing convention: scene Y/Z swap for three.js handedness.
  out.y = simple.z * scale;
  out.z = simple.y * scale;
}
```

Note the Y/Z swap matches the existing `setBodyWorldPosition` (review the existing helper first — line numbers may have shifted). If `setBodyWorldPosition` does the swap, replicate it. If it doesn't, this new helper shouldn't either.

- [ ] **Step 2: Verify**

```bash
cd frontend && npx tsc --noEmit && npm test
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/utils/helpers.tsx
git commit -m "feat(scale): add setBodyWorldPositionWithPreset helper

Mutating-output position writer that uses the scale pipeline instead
of a raw positionScale divisor. Scene consumers migrate to it
file-by-file in subsequent tasks."
```

### Task 3.2 — Migrate Sphere.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Sphere.tsx`

- [ ] **Step 1: Inspect current Sphere.tsx`useFrame` body**

```bash
sed -n '85,165p' src/app/components/scene/Sphere.tsx
```

Note the existing pattern:
- Reads `simulationScale.positionScale` from Redux state in `useFrame`.
- If body has `positionScale !== 1` (Moon case), reads orbiting body position and calls `scaleDistanceInto` to fake parent-relative exaggeration.
- Calls `setBodyWorldPosition(mesh.position, posSimple, simulationScale.positionScale)` to finalize world position.

- [ ] **Step 2: Rewrite to use pipeline**

Replace the body-position computation in `useFrame` (the block from approximately line 117 to 159):

```tsx
const bodyIdx = bodyIdxRef.current;
if (bodyIdx >= 0) {
  readBodyPositionInto(posScratchVec.current, buffer, idx, bodyIdx);
  posSimple.current.x = posScratchVec.current.x;
  posSimple.current.y = posScratchVec.current.y;
  posSimple.current.z = posScratchVec.current.z;

  // Display-frame pivot. Helio writes zero, so no branch needed.
  writePivotInto(pivotScratch.current, buffer, idx, displayFrame);
  posSimple.current.x -= pivotScratch.current.x;
  posSimple.current.y -= pivotScratch.current.y;
  posSimple.current.z -= pivotScratch.current.z;

  if (orbitingBodyNameUpper && orbitingIdxRef.current >= 0) {
    // Body has a parent — use the minimum-separation rule so small
    // satellites (Moon today, Phobos/Deimos/etc. tomorrow) stay
    // visibly separated from their parent in Log preset.
    readBodyPositionInto(
      orbitingScratchVec.current,
      buffer,
      idx,
      orbitingIdxRef.current,
    );
    orbitingSimple.current.x = orbitingScratchVec.current.x - pivotScratch.current.x;
    orbitingSimple.current.y = orbitingScratchVec.current.y - pivotScratch.current.y;
    orbitingSimple.current.z = orbitingScratchVec.current.z - pivotScratch.current.z;

    // Compute parent's world position via the pipeline.
    setBodyWorldPositionWithPreset(
      parentWorldScratch.current,
      orbitingSimple.current,
      simulationScale.preset,
    );

    // Compute child's world-relative-to-parent delta with min-separation.
    worldDistanceFromParent(
      posSimple.current,
      orbitingSimple.current,
      worldRadius(parentRadiusMRef.current, simulationScale.preset),
      worldRadius(radius * REALISTIC_DIVISOR, simulationScale.preset), // own radius in metres
      simulationScale.preset,
      childDeltaScratch.current,
    );

    // Final world position = parent world + delta. Reuse mesh.position
    // directly to avoid extra scratch.
    meshRef.current.position.set(
      parentWorldScratch.current.x + childDeltaScratch.current.x,
      parentWorldScratch.current.y + childDeltaScratch.current.y,
      parentWorldScratch.current.z + childDeltaScratch.current.z,
    );
  } else {
    // No parent — straight pipeline transform.
    setBodyWorldPositionWithPreset(
      meshRef.current.position,
      posSimple.current,
      simulationScale.preset,
    );
  }

  if (lightRef.current) {
    setBodyWorldPositionWithPreset(
      lightRef.current.position,
      posSimple.current,
      simulationScale.preset,
    );
  }
}
```

You'll need to add three new refs at the top of the component:

```tsx
const parentWorldScratch = useRef({ x: 0, y: 0, z: 0 });
const childDeltaScratch = useRef({ x: 0, y: 0, z: 0 });
const parentRadiusMRef = useRef<number>(0);
```

And resolve `parentRadiusMRef.current` lazily inside `useFrame` when the orbiting body index resolves — pull the parent's radius from `propsList`.

Imports at the top of the file:

```tsx
import {
  worldDistance,
  worldRadius,
  worldDistanceFromParent,
  REALISTIC_DIVISOR,
} from "@/app/utils/scalePipeline";
import { setBodyWorldPositionWithPreset } from "@/app/utils/helpers";
```

(Some of these may already be imported — dedupe as needed.)

Drop the now-unused `scaleDistanceInto` import.

The `radius` prop being passed in is already in world units (per Scene.tsx: `props.radius / simulationScale.radiusScale`). After Phase 3, Scene will pass `worldRadius(props.radius, preset)` instead — but we don't want to multiply by REALISTIC_DIVISOR here. Re-check: the `radius` prop is the body's rendered radius in world units, which is what `<sphereGeometry args={[radius, 32, 32]} />` uses. For the min-separation rule we want the body's radius in WORLD UNITS (which `radius` IS), and the parent's radius likewise.

Re-correct the call:

```tsx
worldDistanceFromParent(
  posSimple.current,
  orbitingSimple.current,
  worldRadius(parentRadiusMRef.current, simulationScale.preset),
  radius, // already in world units (Sphere prop)
  simulationScale.preset,
  childDeltaScratch.current,
);
```

And drop the `REALISTIC_DIVISOR` multiplication and import.

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

Expected: clean. (Visual verification at end of phase.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/Sphere.tsx
git commit -m "refactor(scene): migrate Sphere to scalePipeline

Replaces simulationScale.positionScale divide with pipeline calls.
Moon special-case becomes worldDistanceFromParent (body-agnostic min
separation). Other bodies use setBodyWorldPositionWithPreset
directly. Per-frame allocations: zero (all scratches via useRef)."
```

### Task 3.3 — Migrate Trail.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Trail.tsx`

- [ ] **Step 1: Inspect existing trail-vertex transform**

```bash
sed -n '130,210p' src/app/components/scene/Trail.tsx
```

Identify where each trail vertex gets transformed by `positionScale`. Note that trails write to a `Float32Array` buffer, so the transform happens per-vertex.

- [ ] **Step 2: Replace per-vertex transform**

For each trail vertex:
- If body has an `orbitingBody` and `positionScale !== 1` today → use `worldDistanceFromParent` against the parent's position at that timestep.
- Else → use `setBodyWorldPositionWithPreset` (or inline the same math — write each world-axis coordinate directly into the buffer slot).

For perf: writing per-axis into a `Float32Array` is the hot path. Avoid calling `setBodyWorldPositionWithPreset` if it forces extra scratch struct allocations — inline the worldDistance / scale math into a small loop. Pattern:

```tsx
const r_m = Math.sqrt(rx * rx + ry * ry + rz * rz);
const wd = worldDistance(r_m, preset);
const s = r_m === 0 ? 0 : wd / r_m;
buffer[i + 0] = rx * s;
buffer[i + 1] = rz * s; // Y/Z swap
buffer[i + 2] = ry * s;
```

Drop `scaleDistanceInto` import.

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/Trail.tsx
git commit -m "refactor(scene): migrate Trail to scalePipeline

Per-vertex trail transform now goes through worldDistance(preset).
Moon-style child-of-parent vertices use worldDistanceFromParent for
min-separation. No new per-frame allocations — pipeline math inlined
in the vertex-write loop."
```

### Task 3.4 — Migrate Reticle.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Reticle.tsx`

- [ ] **Step 1: Inspect**

```bash
sed -n '90,160p' src/app/components/scene/Reticle.tsx
```

Same pattern as Sphere: reads `simulationScale.positionScale`, may have parent-relative scaling for orbiting bodies, calls `setBodyWorldPosition` at the end.

- [ ] **Step 2: Rewrite using pipeline**

Apply the same pattern as Sphere.tsx (Task 3.2). Imports:

```tsx
import {
  worldDistance,
  worldRadius,
  worldDistanceFromParent,
} from "@/app/utils/scalePipeline";
import { setBodyWorldPositionWithPreset } from "@/app/utils/helpers";
```

Drop `scaleDistanceInto`.

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/Reticle.tsx
git commit -m "refactor(scene): migrate Reticle to scalePipeline"
```

### Task 3.5 — Migrate GhostLabel.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/GhostLabel.tsx`

- [ ] **Step 1: Inspect**

```bash
sed -n '65,115p' src/app/components/scene/GhostLabel.tsx
```

- [ ] **Step 2: Apply the same migration pattern**

Replace `positionScale` divide with `worldDistance` / pipeline calls. Same imports as Sphere/Reticle.

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/GhostLabel.tsx
git commit -m "refactor(scene): migrate GhostLabel to scalePipeline"
```

### Task 3.6 — Migrate Camera.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/Camera.tsx`

- [ ] **Step 1: Inspect**

```bash
sed -n '60,160p' src/app/components/scene/Camera.tsx
```

Camera reads `simulationScale.positionScale` (for active body world position) AND `simulationScale.radiusScale` (for close-up min distance, line ~149).

- [ ] **Step 2: Rewrite**

- Active-body position: use `setBodyWorldPositionWithPreset` (with Moon-rule branch if the active body has an orbitingBody).
- Close-up min distance: replace `bodyRadius / simulationScale.radiusScale` with `worldRadius(bodyRadius, preset)`.

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/Camera.tsx
git commit -m "refactor(scene): migrate Camera to scalePipeline

Active-body world position via pipeline (with Moon-rule branch).
Close-up min distance uses worldRadius(R, preset)."
```

### Task 3.7 — Migrate OrbitPath.tsx

**Files:**
- Modify: `frontend/src/app/components/scene/OrbitPath.tsx`

- [ ] **Step 1: Inspect**

```bash
sed -n '195,230p' src/app/components/scene/OrbitPath.tsx
```

- [ ] **Step 2: Replace per-vertex transform**

OrbitPath samples ellipses at ~64 vertices each. Each vertex currently divides by `simulationScale.positionScale`. Replace with `worldDistance(r, preset)` per vertex, same inlined pattern as Trail (avoid scratch struct allocations).

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/OrbitPath.tsx
git commit -m "refactor(scene): migrate OrbitPath to scalePipeline

Per-ellipse-vertex transform now goes through worldDistance(preset).
Same inlined math as Trail to avoid scratch allocations."
```

### Task 3.8 — Migrate Scene.tsx (body radii via worldRadius)

**Files:**
- Modify: `frontend/src/app/components/scene/Scene.tsx`

- [ ] **Step 1: Inspect**

```bash
sed -n '55,125p' src/app/components/scene/Scene.tsx
```

Note line 67: `map.set(props.name, props.radius / simulationScale.radiusScale)`. This builds the per-body world radius lookup.

- [ ] **Step 2: Rewrite**

Replace with `worldRadius(props.radius, preset)`. Import the pipeline:

```tsx
import { worldRadius } from "@/app/utils/scalePipeline";
```

Also check the AU-grid line (~121): `const auInWu = SimConstants.AU_M / simulationScale.positionScale`. The semantics here differ — this is "how many world units is 1 AU at the current preset for the grid spacing." For Realistic, that's still `AU_M / 1e8 = 1496`. For Log, it's `worldDistance(AU_M, "log")` (~18 wu with defaults).

Replace with:

```tsx
const auInWu = worldDistance(SimConstants.AU_M, simulationScale.preset);
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/scene/Scene.tsx
git commit -m "refactor(scene): migrate Scene body radii + AU grid to pipeline

Per-body world radius now goes through worldRadius(R, preset),
applying the Log preset's floor. AU-grid spacing uses
worldDistance(AU_M, preset) so the grid scales with the active preset."
```

### Task 3.9 — Drop deprecated scale fields + per-body positionScale

**Files:**
- Modify: `frontend/src/app/constants/SimConstants.ts`
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`
- Modify: `frontend/src/app/utils/helpers.tsx`

- [ ] **Step 1: Drop `positionScale`/`radiusScale`/`EXCEPTION_BODIES_POSITION_SCALE` from `SimulationScale`**

In `SimulationSlice.ts`:

```typescript
export interface SimulationScale {
  name: string;
  preset: ScalePreset;
  AXES: {
    SIZE: number;
  };
}
```

- [ ] **Step 2: Drop the same fields from `SimConstants.ts`**

```typescript
SCALE: {
  LOG: {
    name: "Log",
    preset: "log" as const,
    AXES: { SIZE: 150 }, // tunable target — adjust at tuning gate
  },
  REALISTIC: {
    name: "Realistic",
    preset: "realistic" as const,
    AXES: { SIZE: 80_000 },
  },
},
```

Renames `SEMI_REALISTIC` → `LOG`. Drop the old hand-tuned comment about Sun's rendered radius.

- [ ] **Step 3: Update `SimulationSlice` references to `SEMI_REALISTIC`**

Find: `grep -rn "SEMI_REALISTIC" src/app`

Update each site to use `SimConstants.SCALE.LOG`. Especially:
- The slice's initialState (~line 152): `simulationScale: SimConstants.SCALE.SEMI_REALISTIC` → `simulationScale: SimConstants.SCALE.LOG`
- The `cycleSimulationScale` reducer logic (around line 416-446) — it currently toggles between the two presets and rebuilds per-body `positionScale` exceptions from `EXCEPTION_BODIES_POSITION_SCALE`. The whole exception-rebuild block (around 220-230 and 440-450) goes away — per-body positionScale is no longer a thing.

- [ ] **Step 4: Drop `positionScale` from `CelestialBodyProperties`**

In `SimulationSlice.ts`, the interface (~line 39-48):

```typescript
export interface CelestialBodyProperties {
  mu?: number;
  radius?: number;
  name?: string;
  orbitingBody?: string;
  texture?: StaticImageData;
}
```

Drop `positionScale?: number;`.

Find any remaining consumers: `grep -rn "\.positionScale" src/app`. Remove the now-dead refs (Sphere, Trail, Reticle, GhostLabel may still import it from the old code path — they shouldn't after Phase 3 migration, but verify).

- [ ] **Step 5: Drop `scaleDistanceInto` from helpers.tsx**

The helper is no longer called by any scene component. Search to confirm:

```bash
grep -rn "scaleDistanceInto" src/app
```

Expected: zero results. If any remain, those files weren't fully migrated in earlier tasks — go back and fix. Otherwise delete the function from `helpers.tsx`.

- [ ] **Step 6: Update test fixtures**

Slice tests may reference the old fields. Find: `grep -rn "positionScale\|radiusScale\|EXCEPTION_BODIES_POSITION_SCALE" src/app`. Update test fixtures to use the new shape.

- [ ] **Step 7: Verify**

```bash
cd frontend && npx tsc --noEmit && npm run build && npm run lint && npm test
```

Expected: clean. This is the strict gate — if anything still references the dropped fields, TypeScript catches it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(scale): drop deprecated positionScale/radiusScale fields

After scene migration, the old scale knobs are unused. Drops:
- positionScale, radiusScale, EXCEPTION_BODIES_POSITION_SCALE from
  SimulationScale + SimConstants
- per-body positionScale from CelestialBodyProperties
- EXCEPTION_BODIES_POSITION_SCALE rebuild logic from
  cycleSimulationScale and the initial SCALE-preset setup
- scaleDistanceInto from helpers
Renames SCALE.SEMI_REALISTIC -> SCALE.LOG. AXES.SIZE for Log set to
150 as a starting point — tuned at the upcoming tuning gate."
```

### Task 3.10 — Phase 3 verify gate (BIG)

- [ ] **Step 1: Full verify**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all green. This is the strictest pass — every scene component now flows through the pipeline.

- [ ] **Step 2: Browser smoke check**

```bash
cd frontend && npm run dev
```

Open `http://localhost:3001/?dev=1` and:
- Submit a default simulation. Confirm scene renders.
- Toggle the Scale chip (which still says "LIN/LOG" — label update is Phase 4). Realistic preset should look pixel-identical to today's "Realistic." Log preset should show all planets visibly separated.
- In Log preset, watch the Moon orbit Earth at clear visual separation.
- Drag the Log A slider — system size should scale uniformly.
- Drag Log r_ref — outer-planet compression should change.
- Drag R floor — small bodies should grow/shrink to the floor.

- [ ] **Step 3: Push + surface to byeon**

```bash
git push
```

Report: "Phase 3 complete. Scene fully driven by the pipeline. Sliders are live in dev mode. Ready for the tuning gate — go play with A/r_ref/R_floor and pick values you like."

---

## 🎯 Tuning gate (byeon, not the engineer)

**This is byeon's gate, not the engineer's.** No Phase 4 task starts until byeon hands over the final tuned values.

Byeon workflow:
1. `npm run dev`, open `?dev=1`
2. Drag the three sliders until the scene reads well in Log preset
3. Note the final `logScaleA`, `logScaleRRef`, `logRadiusFloor` values from the panel readouts
4. Pick the chip label pair (D5 decision):
   - "Real" / "Spaced"
   - "Real" / "Compressed"
   - "True" / "Visible"
   - "Real" / "Log"
   - Other
5. Send the engineer the four picked values + label pair

---

## Phase 4 — Bake defaults + UI polish

### Task 4.1 — Bake tuned defaults

**Files:**
- Modify: `frontend/src/app/dev/devSettingsStore.ts`
- Modify: `frontend/src/app/utils/scalePipeline.ts` (update `DEFAULT_LOG_*` exports for consistency)
- Modify: `frontend/src/app/constants/SimConstants.ts` (Log preset `AXES.SIZE`)

- [ ] **Step 1: Update `DEFAULTS` in `devSettingsStore.ts`**

Replace the values for `logScaleA`, `logScaleRRef`, `logRadiusFloor` with byeon's tuned values:

```typescript
const DEFAULTS: DevSettings = {
  zoomSensitivity: 0.001,
  orbitDampingFactor: 0.01,
  cameraZoomLerpRate: 0.1,
  trailLength: 1000,
  skyboxVariant: "full",
  logScaleA: <BYEON_PICKED_A>,
  logScaleRRef: <BYEON_PICKED_R_REF>,
  logRadiusFloor: <BYEON_PICKED_FLOOR>,
};
```

- [ ] **Step 2: Update the `DEFAULT_LOG_*` exports in `scalePipeline.ts`**

Keep them in sync with `DEFAULTS` so docs/tests stay consistent:

```typescript
export const DEFAULT_LOG_SCALE_A = <BYEON_PICKED_A>;
export const DEFAULT_LOG_R_REF_M = <BYEON_PICKED_R_REF>;
export const DEFAULT_LOG_RADIUS_FLOOR_WU = <BYEON_PICKED_FLOOR>;
```

- [ ] **Step 3: Update Log preset `AXES.SIZE` in `SimConstants.ts`**

`AXES.SIZE` for the Log preset should be ~`1.5 × A` (Neptune's world position with the tuned A). For A=60, that's ~90; with a comfortable headroom multiplier, ~150 is fine. Adjust if byeon's A is significantly different.

- [ ] **Step 4: Update tests**

Tests in `scalePipeline.test.ts` reference `DEFAULT_LOG_SCALE_A` — they should still pass (re-run to confirm). If any anchor-value tests (Earth at A*log10(2)) had hardcoded numerics, update them.

- [ ] **Step 5: Verify**

```bash
cd frontend && npm run build && npm run lint && npm test
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scale): bake tuned Log-preset defaults

A=<A>, r_ref=<R_REF>, R_floor=<FLOOR>. Picked from live dev-mode
tuning. Production builds now ship with these as defaults; dev
sliders can still override at runtime."
```

### Task 4.2 — Update the Scale chip label

**Files:**
- Modify: `frontend/src/app/components/chrome/Timeline.tsx`

- [ ] **Step 1: Locate the chip**

Current code at `Timeline.tsx:283-286`:

```tsx
// UI label cycles LIN/LOG; backing logic still cycles
// SEMI_REALISTIC ↔ REALISTIC. Real logarithmic radial compression is
// queued (#61); once it lands the labels become literally accurate.
const scaleLabel = scale.name === "Realistic" ? "LIN" : "LOG";
```

- [ ] **Step 2: Replace with byeon's picked pair**

Example (using "Real" / "Spaced" — replace with byeon's actual pick):

```tsx
// LIN/LOG is now literally accurate — Realistic preset uses linear
// scale, Log preset uses log1p radial compression via scalePipeline.
// Per the project copy convention (plain English in UI prose), the
// chip values surface in lay terms.
const scaleLabel = scale.name === "Realistic" ? "Real" : "Spaced";
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/components/chrome/Timeline.tsx
git commit -m "feat(ui): rewrite Scale chip label to plain English

Per byeon decision: <PICKED-PAIR>. The behind-the-scenes preset
toggle now matches the chip label literally — Log preset truly
applies log compression."
```

### Task 4.3 — Sweep stale comments + todo.md

**Files:**
- Modify: `frontend/src/app/utils/scalePipeline.ts` (drop "tuning starting points" wording)
- Modify: `frontend/src/app/constants/SimConstants.ts` (audit any remaining stale comments)
- Modify: `todo.md` (delete #61)

- [ ] **Step 1: Remove tuning-era language**

In `scalePipeline.ts`, the comment about "These are tuning starting points. Final values get picked at the post-Phase-3 tuning gate" is no longer accurate. Replace with a stable comment:

```typescript
// Log preset production defaults. Live-overridable in dev mode via
// devSettingsStore (?dev=1 unlocks the slider panel).
```

- [ ] **Step 2: Drop the stale audit comment in `SimConstants.ts`**

If any "hand-tuned against Sun's rendered radius" comment lingered after Task 3.9, remove it.

- [ ] **Step 3: Delete todo #61**

Open `todo.md`, find `- [ ] **61. Log distance scaling (redesign Phase 9) ...`, delete the entire bullet block including the indented sub-bullets.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/utils/scalePipeline.ts frontend/src/app/constants/SimConstants.ts todo.md
git commit -m "chore(scale): clean up tuning-era comments + drop todo #61"
```

(`todo.md` is gitignored — the commit still works; just won't include it. That's fine.)

---

## Phase 5 — Final verification + cleanup

### Task 5.1 — Visual A/B verify

- [ ] **Step 1: Realistic regression check**

```bash
cd frontend && npm run dev
```

Open the app, default sim, no `?dev` flag. Toggle to Realistic. Confirm the scene looks pixel-identical to pre-change Realistic. (Body sizes, body positions, AU-grid spacing, camera bounds.)

- [ ] **Step 2: Log preset check**

Toggle to Log. Confirm:
- Whole solar system fits in default viewport
- Every planet is visibly separated and clickable
- Moon orbits Earth with clear visual gap
- Camera zoom doesn't clip into bodies at close-up
- AU grid spacing reads sensibly (compressed by log)

- [ ] **Step 3: If anything looks off**

Roll back to Phase 4 tuning, re-pick values, re-run Tasks 4.1-4.3.

### Task 5.2 — Update ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Add a resolved design decision entry**

Find the "Resolved design decisions" section (the integrator-residuals work added #15 here). Add the next number:

```markdown
### #16: Two-preset scale system (Realistic + Log) via explicit pipeline functions

Replaced the legacy `positionScale` / `radiusScale` knobs (which had a 40× body-vs-distance distortion in the "Semi-Realistic" preset) with a single pipeline (`worldDistance`, `worldRadius`, `worldDistanceFromParent`) that switches behavior on a preset enum. Realistic preserves physically accurate ratios (bodies as dots). Log applies `A · log10(1 + r/r_ref)` radial compression plus a clickability floor on body radii, so the whole solar system fits in one viewport with every planet visibly separated. The Moon-`×15` exception became a body-agnostic minimum-separation rule that works for any future child satellite.
```

(Adjust the section number to whatever's next after #15. Use prose tone matching the rest of ARCHITECTURE.md.)

- [ ] **Step 2: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs(arch): resolved design decision for scale pipeline

Two-preset (Realistic + Log) with explicit pipeline functions.
Replaces the broken positionScale / radiusScale knobs."
```

### Task 5.3 — Final full verify

- [ ] **Step 1: Run full test + build + lint pass**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all green. Tests should be ≥150 (141 baseline + scale pipeline tests added).

- [ ] **Step 2: Push final branch state**

```bash
git push
```

- [ ] **Step 3: Surface to byeon for merge gate**

Per branch-workflow rule: report what's landed, what was verified, and stop. Do NOT merge.

Sample message:
> "Branch `scale-pipeline` ready for review. Phases 1-5 complete: pipeline shipped, dev tuner wired, scene migrated, defaults baked at A=`<A>`, r_ref=`<R_REF>`, R_floor=`<FLOOR>`, label = `<PAIR>`. Build + lint + tests all green. Visual A/B verified — Realistic is pixel-identical, Log shows the whole system in one viewport. Ready to merge to master when you say go."

Wait for byeon's explicit verification before merging. After verification:

```bash
git checkout master
git pull --ff-only
git merge --no-ff scale-pipeline -m "Merge branch 'scale-pipeline': true LIN/LOG scale presets via explicit pipeline (#61)"
cd frontend && npm test
git push origin master
git branch -d scale-pipeline
git push origin --delete scale-pipeline
```

---

## Risks (carry-forward from spec)

1. **Per-frame perf in render loop.** Pipeline calls add a function-call overhead per body per frame. Mitigation: indexed math, no allocations, no streams. Verify with `npm run dev` and check the FPS counter doesn't drop in Log preset. If any frame-allocation slips in, the path-scoped render-loop rules catch it on review.

2. **Visual regression in Realistic.** Must look pixel-identical to today. Mitigation: Task 5.1 visual A/B check + the test that asserts `worldDistance(r, "realistic") === r / 1e8`.

3. **Camera bounds in Log preset.** With Log's compressed extent ~90 wu, `AXES.SIZE = 150` and `CAMERA_MAX_DISTANCE_MULTIPLIER = 5` gives max-zoom-out of 750 wu, well under `STARS_RADIUS × 0.9 = 90,000 wu`. Should be fine; verify in Task 3.10 / 5.1.

4. **Hermite interpolation runs pre-pipeline.** Hermite operates on raw metre snapshots; the pipeline transforms metre-positions to world-units at render time. They're orthogonal. No risk.

5. **OrbitPath sampling looks faceted.** Per-vertex log transform is monotonic and smooth, so the rendered ellipse should still look smooth. If it doesn't, increase vertex count in OrbitPath (defaulted to 64 today).