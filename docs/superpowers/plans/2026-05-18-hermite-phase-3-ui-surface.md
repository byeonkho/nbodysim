# Hermite Phase 3 UI Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the backend keyframe-thinning lever in the SimSetupDrawer as a "Playback quality" control — 5-preset segmented picker + custom override + per-integrator defaults — and wire it through `InitializeRequest.keyframeIntervalSec` so users can trade smoothness for bandwidth.

**Architecture:** A new `PlaybackQuality.ts` module owns the 5 preset multipliers, per-integrator defaults, and pure helpers (preset→multiplier, multiplier→active-preset-key, stepDt-seconds conversion, custom-input validation). A small `<InfoTooltip>` component (hand-rolled, no new dep) renders the spec's "small info icon next to the field." A `<PlaybackQualityPicker>` component (hand-rolled segmented buttons + custom numeric input) is dropped into `SimSetupDrawer` between the existing integrator/time-unit fields and the body picker. The drawer owns `qualityMultiplier` state, resets it to the integrator's default on integrator change, and computes `keyframeIntervalSec = qualityMultiplier · stepDtSeconds(timeStepUnit)` at submit time. Pure logic is unit-tested; the UI is verified by manual browser smoke — matching the existing frontend test pattern (vitest with `environment: "node"`, no jsdom/RTL).

**Tech Stack:** TypeScript, Next.js (React), Tailwind CSS, Vitest (node env), Redux Toolkit. **No new dependencies** — hand-rolled picker + tooltip per design decisions confirmed before planning.

**Spec:** [docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md](../specs/2026-05-15-hermite-keyframe-interpolation-design.md), "Phase 3 — UI surface" section.

**Branch:** `hermite-phase-3-ui` (per `branch-workflow.md`; branch off **master**, which now has Phases 1+2 merged).

**Hot-path rules in scope:** None. `SimSetupDrawer` is form UI, not render-loop code. [frontend-render-loop.md](../../../.claude/rules/frontend-render-loop.md) does not apply.

---

## Design decisions confirmed before planning

- **Picker style:** hand-rolled segmented buttons (5 `<button>` in a row), matching the drawer's existing custom-component pattern (`BodySphere`, `ToggleSwitch`). No new dependency. Spec called for Radix `RadioGroup` — deviation rationale: `@radix-ui/react-radio-group` is not installed, every other form field in the drawer is native HTML, and adding one Radix primitive for one control breaks pattern consistency.
- **Tooltip style:** custom small `<InfoTooltip>` component (info-icon button + absolute-positioned tooltip on hover/focus). Spec called for "small info icon next to the field" — this matches literally without a new dep. CSS-only `:hover` + `:focus-within` for show/hide; no JS state, no portal. Mobile UX is a Phase 8 concern (todo #35).
- **Frontend stepDt helper location:** `PlaybackQuality.ts` (co-located with the only consumer). Promote to a shared module if a second consumer arrives later.
- **Tests:** pure-logic only (vitest, node env). No jsdom + `@testing-library/react` infrastructure — that would be net-new test infrastructure and CLAUDE.md flags dep additions. The picker + drawer integration get a manual browser smoke instead, matching the existing pattern (no `*.test.tsx` files anywhere in the repo today).

---

## File Map

**Frontend (created):**
- `frontend/src/app/constants/PlaybackQuality.ts` — preset table, per-integrator defaults, type-safe lookups, `stepDtSeconds(unit)` helper, `getActivePresetKey(multiplier)` helper, `parseCustomMultiplier(s)` validator.
- `frontend/src/app/constants/PlaybackQuality.test.ts` — pure-logic tests: preset shape, integrator-default sanity, stepDt conversion across all 4 units, active-preset-key edge cases, custom-multiplier parsing/clamping.
- `frontend/src/app/components/chrome/InfoTooltip.tsx` — small reusable info-icon button with hover/focus tooltip. Inline SVG icon, Tailwind-styled tooltip, CSS-only visibility.
- `frontend/src/app/components/chrome/PlaybackQualityPicker.tsx` — controlled component: segmented preset buttons + custom numeric input + inline validation message. Single `multiplier` prop (number, source of truth) + `onChange(multiplier)`. Active preset is computed via `getActivePresetKey`. Reports validity to parent via `onValidityChange(valid)`.

**Frontend (modified):**
- `frontend/src/app/components/chrome/SimSetupDrawer.tsx` — add `qualityMultiplier` + `qualityValid` state; useEffect on `integrator` change resets multiplier to that integrator's default; render `<PlaybackQualityPicker>` between time-unit and body picker; wire `keyframeIntervalSec = qualityMultiplier * stepDtSeconds(timeStepUnit)` into `requestPayload`; disable submit button when picker is invalid.
- `frontend/src/app/store/slices/SimulationSlice.ts` — extend `LastSimRequest` interface with optional `keyframeIntervalSec?: number` (mirrors the `InitializeRequest` field that already exists in `initializeCelestialBodies.tsx`).
- `frontend/src/app/store/middleware/userActionLogger.ts` — extend the `lastRequest` selector type with the same optional field (no log-message change; just keeps the types in sync).
- `frontend/src/app/store/middleware/userActionLogger.test.ts` — extend the fixture's `lastRequest` shape with the optional field if needed (likely a no-op since the field is optional).

**Out of scope:**
- jsdom + RTL setup for component integration tests.
- `@radix-ui/react-tooltip` or `@radix-ui/react-radio-group` additions.
- Sticky-override UX (preserve custom value across integrator change) — spec calls this out as deferred, "If users complain, file as follow-up."
- Mobile touch behavior for the picker — Phase 8 / todo #35.
- localStorage persistence — spec explicitly says per-session only.

---

## Task 1: Create branch + commit plan doc

**Files:**
- Create branch `hermite-phase-3-ui`
- Commit: `docs/superpowers/plans/2026-05-18-hermite-phase-3-ui-surface.md`

- [ ] **Step 1: Branch off master**

```bash
git fetch origin master
git checkout -b hermite-phase-3-ui origin/master
git status
```

Expected: `Switched to a new branch 'hermite-phase-3-ui'`, clean tree apart from the untracked plan doc.

- [ ] **Step 2: Commit the plan doc**

```bash
git add docs/superpowers/plans/2026-05-18-hermite-phase-3-ui-surface.md
git commit -m "$(cat <<'EOF'
plan: phase 3 of hermite keyframe interpolation (UI surface)

Adds the implementation plan for Phase 3 of #20 — SimSetupDrawer
"Playback quality" control (5-preset segmented picker + custom override)
that populates the new InitializeRequest.keyframeIntervalSec field
landed in Phase 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: PlaybackQuality.ts module + pure-logic tests

**Files:**
- Create: `frontend/src/app/constants/PlaybackQuality.ts`
- Create: `frontend/src/app/constants/PlaybackQuality.test.ts`

TDD: write tests first, run, expect failure (module doesn't exist), implement, expect pass.

- [ ] **Step 1: Write the failing test file**

Create `frontend/src/app/constants/PlaybackQuality.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PLAYBACK_QUALITY_PRESETS,
  INTEGRATOR_QUALITY_DEFAULTS,
  getActivePresetKey,
  stepDtSeconds,
  parseCustomMultiplier,
  MAX_QUALITY_MULTIPLIER,
  type PlaybackQualityKey,
} from "./PlaybackQuality";

describe("PLAYBACK_QUALITY_PRESETS", () => {
  it("has the 5 expected keys with monotonically increasing multipliers", () => {
    const keys = Object.keys(PLAYBACK_QUALITY_PRESETS) as PlaybackQualityKey[];
    expect(keys).toEqual(["high", "medHigh", "medium", "medLow", "low"]);
    const multipliers = keys.map((k) => PLAYBACK_QUALITY_PRESETS[k].multiplier);
    expect(multipliers).toEqual([1, 2, 4, 8, 16]);
  });

  it("every preset has a non-empty label", () => {
    for (const preset of Object.values(PLAYBACK_QUALITY_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });
});

describe("INTEGRATOR_QUALITY_DEFAULTS", () => {
  it("every integrator default is a valid preset key", () => {
    const presetKeys = new Set(Object.keys(PLAYBACK_QUALITY_PRESETS));
    for (const [integrator, presetKey] of Object.entries(
      INTEGRATOR_QUALITY_DEFAULTS,
    )) {
      expect(presetKeys.has(presetKey)).toBe(true);
    }
  });

  it("covers the three integrators the form exposes", () => {
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("euler");
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("rk4");
    expect(INTEGRATOR_QUALITY_DEFAULTS).toHaveProperty("dp853");
  });
});

describe("getActivePresetKey", () => {
  it("returns the matching preset key when multiplier equals a preset", () => {
    expect(getActivePresetKey(1)).toBe("high");
    expect(getActivePresetKey(2)).toBe("medHigh");
    expect(getActivePresetKey(4)).toBe("medium");
    expect(getActivePresetKey(8)).toBe("medLow");
    expect(getActivePresetKey(16)).toBe("low");
  });

  it("returns null when multiplier doesn't match any preset (custom value)", () => {
    expect(getActivePresetKey(3)).toBeNull();
    expect(getActivePresetKey(5)).toBeNull();
    expect(getActivePresetKey(100)).toBeNull();
  });
});

describe("stepDtSeconds", () => {
  it("returns 1.0 for seconds", () => {
    expect(stepDtSeconds("Seconds")).toBe(1);
  });

  it("returns 3600 for hours", () => {
    expect(stepDtSeconds("Hours")).toBe(3600);
  });

  it("returns 86400 for days", () => {
    expect(stepDtSeconds("Days")).toBe(86400);
  });

  it("returns 604800 for weeks", () => {
    expect(stepDtSeconds("Weeks")).toBe(7 * 86400);
  });

  it("is case-insensitive", () => {
    expect(stepDtSeconds("seconds")).toBe(1);
    expect(stepDtSeconds("HOURS")).toBe(3600);
  });

  it("throws on unknown unit", () => {
    expect(() => stepDtSeconds("Fortnights")).toThrow();
  });
});

describe("MAX_QUALITY_MULTIPLIER", () => {
  it("matches the backend's MAX_KEYFRAMES_PER_KEPT", () => {
    expect(MAX_QUALITY_MULTIPLIER).toBe(100);
  });
});

describe("parseCustomMultiplier", () => {
  it("accepts integer strings in range [1, 100]", () => {
    expect(parseCustomMultiplier("1")).toEqual({ value: 1, error: null });
    expect(parseCustomMultiplier("50")).toEqual({ value: 50, error: null });
    expect(parseCustomMultiplier("100")).toEqual({ value: 100, error: null });
  });

  it("returns error for 0", () => {
    const result = parseCustomMultiplier("0");
    expect(result.value).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("returns error for negative", () => {
    expect(parseCustomMultiplier("-5").value).toBeNull();
  });

  it("returns error for above max", () => {
    expect(parseCustomMultiplier("101").value).toBeNull();
    expect(parseCustomMultiplier("999").value).toBeNull();
  });

  it("returns error for non-integer", () => {
    expect(parseCustomMultiplier("3.5").value).toBeNull();
    expect(parseCustomMultiplier("abc").value).toBeNull();
  });

  it("returns error for empty string", () => {
    expect(parseCustomMultiplier("").value).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseCustomMultiplier("  4  ")).toEqual({ value: 4, error: null });
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
cd frontend && npx vitest run src/app/constants/PlaybackQuality.test.ts
```

Expected: FAIL — `Failed to resolve import "./PlaybackQuality"` or similar. **Do not commit yet.**

- [ ] **Step 3: Create the module**

Create `frontend/src/app/constants/PlaybackQuality.ts`:

```ts
/**
 * Playback quality presets — the user-facing axis that maps to the
 * backend's keyframeIntervalSec lever (see Hermite Phase 2 spec). Higher
 * "quality" = more keyframes shipped per chunk = smoother playback per
 * step but larger compressed payloads. Lower quality = fewer keyframes,
 * Hermite interpolation fills the gaps. The "× stepDt" framing is internal;
 * the user picks a label or types a custom multiplier.
 */
export const PLAYBACK_QUALITY_PRESETS = {
  high:    { multiplier: 1,  label: "High" },
  medHigh: { multiplier: 2,  label: "Med-High" },
  medium:  { multiplier: 4,  label: "Medium" },
  medLow:  { multiplier: 8,  label: "Med-Low" },
  low:     { multiplier: 16, label: "Low" },
} as const;

export type PlaybackQualityKey = keyof typeof PLAYBACK_QUALITY_PRESETS;

/**
 * Default preset per integrator. Rationale (from the spec):
 * - euler:  K=1 — Euler is already crude; no point ditching keyframes.
 * - rk4:    K=4 — balanced; interpolation hides most thinning artifacts.
 * - dp853:  K=8 — DP853's orbits are smooth and over-sampled at fixed dt,
 *           so aggressive thinning + Hermite still looks great.
 */
export const INTEGRATOR_QUALITY_DEFAULTS: Record<string, PlaybackQualityKey> = {
  euler:  "high",
  rk4:    "medium",
  dp853:  "medLow",
};

/**
 * Mirror of {@code SimulationLimits.MAX_KEYFRAMES_PER_KEPT} on the backend.
 * Kept in sync manually — if the backend cap changes, change here too.
 */
export const MAX_QUALITY_MULTIPLIER = 100;

/**
 * Returns the preset key whose multiplier matches the given value, or
 * null if no preset matches (i.e., the picker is in "custom" mode).
 */
export function getActivePresetKey(multiplier: number): PlaybackQualityKey | null {
  for (const [key, preset] of Object.entries(PLAYBACK_QUALITY_PRESETS) as Array<
    [PlaybackQualityKey, { multiplier: number; label: string }]
  >) {
    if (preset.multiplier === multiplier) return key;
  }
  return null;
}

/**
 * Converts the drawer's timeStepUnit string to seconds. Mirrors the
 * backend's stepDtSeconds switch in SimulationController. The drawer's
 * TIME_UNITS values are capitalized ("Seconds", "Hours", "Days", "Weeks");
 * this function is case-insensitive to be defensive.
 */
export function stepDtSeconds(timeStepUnit: string): number {
  switch (timeStepUnit.toLowerCase()) {
    case "seconds": return 1;
    case "hours":   return 3600;
    case "days":    return 86400;
    case "weeks":   return 7 * 86400;
    default:
      throw new Error(`Unsupported time step unit: ${timeStepUnit}`);
  }
}

/**
 * Parses + validates a string from the "Custom" numeric input. Accepts
 * positive integers in [1, MAX_QUALITY_MULTIPLIER]. Returns either a
 * parsed value (error null) or a user-facing error message (value null).
 */
export function parseCustomMultiplier(
  raw: string,
): { value: number; error: null } | { value: null; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: null, error: "Enter a number" };
  }
  if (!/^-?\d+$/.test(trimmed)) {
    return { value: null, error: "Must be a whole number" };
  }
  const n = Number(trimmed);
  if (n < 1) {
    return { value: null, error: "Must be at least 1" };
  }
  if (n > MAX_QUALITY_MULTIPLIER) {
    return { value: null, error: `Must be at most ${MAX_QUALITY_MULTIPLIER}` };
  }
  return { value: n, error: null };
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
npx vitest run src/app/constants/PlaybackQuality.test.ts
```

Expected: PASS — `Tests: 22 passed`. (Each `it()` is one test; counts may vary by ±1 depending on whether your shell counts the suite headers.)

- [ ] **Step 5: Run full frontend test suite (regression check)**

```bash
npm test
```

Expected: BUILD SUCCESS, full suite passes (107 → ~129 with new tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/constants/PlaybackQuality.ts \
        frontend/src/app/constants/PlaybackQuality.test.ts
git commit -m "$(cat <<'EOF'
feat(constants): add PlaybackQuality presets + helpers

5-preset quality table (High/Med-High/Medium/Med-Low/Low → multipliers
1/2/4/8/16), per-integrator defaults, MAX_QUALITY_MULTIPLIER mirror of
the backend cap, stepDtSeconds helper (mirrors the backend controller's
switch), and parseCustomMultiplier validator.

Pure logic, all tested. UI surface arrives in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: InfoTooltip component

**Files:**
- Create: `frontend/src/app/components/chrome/InfoTooltip.tsx`

Small, reusable, no dependencies. Pure presentational — the tooltip is just an absolute-positioned `<div>` made visible via Tailwind's `group-hover:` / `group-focus-within:` utilities. Inline SVG for the info icon.

- [ ] **Step 1: Create the component**

Create `frontend/src/app/components/chrome/InfoTooltip.tsx`:

```tsx
"use client";

/**
 * Small info-icon button with a hover/focus tooltip. CSS-only visibility
 * via Tailwind group-hover / group-focus-within — no JS state, no portal.
 * Desktop-focused; mobile touch UX is a Phase 8 (#35) concern. Tooltip
 * appears above-right of the icon; if the field is near the right edge of
 * the drawer the tooltip may clip — acceptable for the SimSetupDrawer's
 * fixed-width left-rail layout.
 */
export function InfoTooltip({
  label,
  children,
}: {
  /** Screen-reader label for the icon button. */
  label: string;
  /** Tooltip body (text or rich content). */
  children: React.ReactNode;
}) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        className="text-dim hover:text-hi focus-visible:text-hi flex h-4 w-4 items-center justify-center rounded-full outline-none transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM7 6.5a1 1 0 112 0v4.5a1 1 0 11-2 0V6.5zM8 3.75a1 1 0 100 2 1 1 0 000-2z" />
        </svg>
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 bottom-full z-50 mb-2 w-64 -translate-x-1/2 rounded-md border border-white/[0.08] bg-[#0c0e15] px-3 py-2 text-[11px] leading-[1.5] text-hi opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        style={{ background: "rgba(10, 12, 20, 0.96)" }}
      >
        {children}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Verify build + lint**

```bash
npm run build && npm run lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/chrome/InfoTooltip.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): add InfoTooltip component

Small reusable info-icon button with CSS-only hover/focus tooltip.
Tailwind group-hover + group-focus-within for visibility, no JS state,
no portal, no new dependency. First consumer is the Playback quality
control in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PlaybackQualityPicker component

**Files:**
- Create: `frontend/src/app/components/chrome/PlaybackQualityPicker.tsx`

Controlled component. Parent owns `multiplier`. Picker computes which segment is active via `getActivePresetKey`. Custom input parses on every keystroke, reports validity up.

- [ ] **Step 1: Create the picker**

Create `frontend/src/app/components/chrome/PlaybackQualityPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  PLAYBACK_QUALITY_PRESETS,
  type PlaybackQualityKey,
  getActivePresetKey,
  parseCustomMultiplier,
} from "@/app/constants/PlaybackQuality";

/**
 * Controlled picker for the keyframe-thinning lever. Single source of
 * truth is the parent-owned `multiplier` number. The picker derives
 * which preset (if any) to highlight via getActivePresetKey, and keeps
 * a local string for the "Custom" input field so the user can type
 * freely (including transient invalid states like empty / "1." etc).
 *
 * Reports validity upward so the parent's submit button can be disabled
 * while the custom input is invalid. Pressing a preset always produces
 * a valid state (presets are by definition valid).
 *
 * No new dependency — 5 hand-rolled `<button>` elements form the
 * segmented control, matching the drawer's existing custom-component
 * pattern (BodySphere, ToggleSwitch).
 */
export function PlaybackQualityPicker({
  multiplier,
  onChange,
  onValidityChange,
}: {
  multiplier: number;
  onChange: (multiplier: number) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const activeKey = getActivePresetKey(multiplier);

  // Local input string — separate from `multiplier` so the user can type
  // intermediate values without forcing the parent into an invalid state.
  // Synced from `multiplier` whenever it changes externally (e.g., when
  // the parent resets it on integrator change, or the user clicks a preset).
  const [customRaw, setCustomRaw] = useState<string>(String(multiplier));
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    setCustomRaw(String(multiplier));
    setCustomError(null);
    onValidityChange(true);
  }, [multiplier, onValidityChange]);

  const handlePresetClick = (key: PlaybackQualityKey) => {
    onChange(PLAYBACK_QUALITY_PRESETS[key].multiplier);
    // useEffect above will sync customRaw + clear error + report valid.
  };

  const handleCustomChange = (raw: string) => {
    setCustomRaw(raw);
    const result = parseCustomMultiplier(raw);
    if (result.error !== null) {
      setCustomError(result.error);
      onValidityChange(false);
      return;
    }
    setCustomError(null);
    onValidityChange(true);
    if (result.value !== multiplier) {
      onChange(result.value);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Segmented preset buttons */}
      <div
        className="flex overflow-hidden rounded-lg border border-white/[0.08]"
        role="radiogroup"
        aria-label="Playback quality preset"
      >
        {(Object.entries(PLAYBACK_QUALITY_PRESETS) as Array<
          [PlaybackQualityKey, { multiplier: number; label: string }]
        >).map(([key, preset], i, arr) => {
          const isActive = activeKey === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => handlePresetClick(key)}
              className={[
                "flex-1 px-2 py-2 text-[11px] font-medium transition-colors",
                isActive
                  ? "bg-accent text-bg"
                  : "text-dim hover:bg-white/[0.04] hover:text-hi",
                i < arr.length - 1 && "border-r border-white/[0.08]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Custom override */}
      <div className="flex items-center gap-2">
        <label className="text-dim text-[11px]" htmlFor="quality-custom">
          Custom
        </label>
        <input
          id="quality-custom"
          type="number"
          min={1}
          max={100}
          step={1}
          value={customRaw}
          onChange={(e) => handleCustomChange(e.target.value)}
          className="w-16 rounded-md border border-white/[0.08] bg-transparent px-2 py-1 text-[12px] text-hi outline-none focus:border-white/[0.20]"
          style={{ background: "rgba(255,255,255,0.04)" }}
          aria-label="Custom keyframe interval multiplier"
          aria-invalid={customError !== null}
        />
        <span className="text-dim text-[11px]">× step</span>
      </div>

      {customError && (
        <p className="text-[11px] text-red-400" role="alert">
          {customError}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build + lint + tsc**

```bash
npm run build && npm run lint && npx tsc --noEmit 2>&1 | grep -v "userActionLogger.test.ts" | tail -10
```

Expected: build + lint pass. `tsc --noEmit` may surface the pre-existing `userActionLogger.test.ts:70` error (already known per CLAUDE.md). The grep above filters it so any *new* type errors stand out.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/components/chrome/PlaybackQualityPicker.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): add PlaybackQualityPicker component

Controlled 5-button segmented preset picker + custom numeric input,
hand-rolled with Tailwind. No new dependency. Reports validity upward
so the drawer's submit button can disable on invalid custom input.

Single source of truth is the parent-owned `multiplier` prop; active
preset is derived via getActivePresetKey. Custom input maintains a local
string so users can type intermediate values without forcing transient
invalid state upstream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Slice + userActionLogger type plumbing

**Files:**
- Modify: `frontend/src/app/store/slices/SimulationSlice.ts`
- Modify: `frontend/src/app/store/middleware/userActionLogger.ts`

Both interfaces describe the shape of the "last request" — needs to mirror the `InitializeRequest` field that already exists in `initializeCelestialBodies.tsx`.

- [ ] **Step 1: Extend `LastSimRequest` in the slice**

In `frontend/src/app/store/slices/SimulationSlice.ts`, update the interface:

```ts
export interface LastSimRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: string;
  /** Optional — populated by SimSetupDrawer Phase 3 onward. */
  keyframeIntervalSec?: number;
}
```

- [ ] **Step 2: Extend the `lastRequest` selector type in userActionLogger**

In `frontend/src/app/store/middleware/userActionLogger.ts`, find the selector type block (around line 32):

```ts
      lastRequest: {
        celestialBodyNames: string[];
        integrator: string;
        frame: string;
      } | null;
```

Replace with:

```ts
      lastRequest: {
        celestialBodyNames: string[];
        integrator: string;
        frame: string;
        keyframeIntervalSec?: number;
      } | null;
```

No log-message change — the existing `Sim init` line builder doesn't reference the new field.

- [ ] **Step 3: Verify build + tests**

```bash
npm run build && npm test
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/store/slices/SimulationSlice.ts \
        frontend/src/app/store/middleware/userActionLogger.ts
git commit -m "$(cat <<'EOF'
feat(store): mirror optional keyframeIntervalSec in LastSimRequest

LastSimRequest + userActionLogger's selector type both gain optional
keyframeIntervalSec field, mirroring InitializeRequest (already extended
in Phase 2). Wires types up ahead of the SimSetupDrawer Phase 3 control
populating the field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SimSetupDrawer wire-up

**Files:**
- Modify: `frontend/src/app/components/chrome/SimSetupDrawer.tsx`

Add state, render the picker, wire submit. The drawer owns `qualityMultiplier` + `qualityValid` and resets the multiplier when integrator changes.

- [ ] **Step 1: Add imports**

In `frontend/src/app/components/chrome/SimSetupDrawer.tsx`, update the existing `useState` import and add the new module imports near the top:

```ts
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useDispatch } from "react-redux";
import { initializeCelestialBodies } from "@/app/utils/initializeCelestialBodies";
import type { AppDispatch } from "@/app/store/Store";
import { store } from "@/app/store/Store";
import { dispatchChunkRequest } from "@/app/store/middleware/simulationRequestThunk";
import { setLastSimRequest } from "@/app/store/slices/SimulationSlice";
import {
  BODY_DISPLAY,
  BODY_ORDER,
  type BodyKey,
} from "@/app/constants/BodyVisuals";
import { BodySphere } from "@/app/components/chrome/BodySphere";
import { PlaybackQualityPicker } from "@/app/components/chrome/PlaybackQualityPicker";
import { InfoTooltip } from "@/app/components/chrome/InfoTooltip";
import {
  PLAYBACK_QUALITY_PRESETS,
  INTEGRATOR_QUALITY_DEFAULTS,
  stepDtSeconds,
} from "@/app/constants/PlaybackQuality";
```

- [ ] **Step 2: Add quality state**

Just after the existing `useState` declarations (after `timeStepUnit`), add:

```tsx
  const [qualityMultiplier, setQualityMultiplier] = useState<number>(
    PLAYBACK_QUALITY_PRESETS[INTEGRATOR_QUALITY_DEFAULTS[integrator]].multiplier,
  );
  const [qualityValid, setQualityValid] = useState<boolean>(true);

  // Reset quality to the new integrator's default whenever integrator changes.
  // Simple model — discards any custom value the user typed. Sticky-override
  // is deferred per spec.
  useEffect(() => {
    const defaultKey = INTEGRATOR_QUALITY_DEFAULTS[integrator];
    if (defaultKey) {
      setQualityMultiplier(PLAYBACK_QUALITY_PRESETS[defaultKey].multiplier);
    }
  }, [integrator]);
```

- [ ] **Step 3: Wire submit payload**

Update `handleSubmit` — replace the `requestPayload` construction with:

```tsx
      const requestPayload = {
        celestialBodyNames,
        date,
        frame,
        integrator,
        timeStepUnit,
        keyframeIntervalSec: qualityMultiplier * stepDtSeconds(timeStepUnit),
      };
```

- [ ] **Step 4: Render the picker field**

Find the existing "Time unit" `<Field>` block (around line 185–201). After it closes (after `</Field>`), insert a new field:

```tsx
            <Field
              label={
                <span className="flex items-center gap-1.5">
                  Playback quality
                  <InfoTooltip label="What is playback quality?">
                    Lower quality ships fewer keyframes — smaller payloads,
                    smoother bandwidth, but motion between samples is
                    interpolated. Higher quality ships every step.
                  </InfoTooltip>
                </span>
              }
            >
              <PlaybackQualityPicker
                multiplier={qualityMultiplier}
                onChange={setQualityMultiplier}
                onValidityChange={setQualityValid}
              />
            </Field>
```

**Important:** the existing `Field` component types `label` as `string` ([SimSetupDrawer.tsx:280-290](frontend/src/app/components/chrome/SimSetupDrawer.tsx:280)). To pass the JSX above, widen the prop type:

Find the `Field` component definition (around line 280) and change:

```tsx
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
```

to:

```tsx
function Field({
  label,
  help,
  children,
}: {
  label: React.ReactNode;
  help?: string;
  children: React.ReactNode;
}) {
```

This is a strict widening (`string` is a subtype of `React.ReactNode`); every existing `<Field label="...">` call site continues to compile.

- [ ] **Step 5: Disable submit when picker is invalid**

Find the submit button (search for "Run" inside the file — it's the primary action). Add `disabled={!qualityValid}` (and a corresponding disabled style if not already styled). Open the file first to find the exact existing markup:

```bash
grep -n "type=\"submit\"\|onClick={handleSubmit}\|>Run<" frontend/src/app/components/chrome/SimSetupDrawer.tsx
```

In the matching block, modify the button props from:

```tsx
            <button
              type="button"
              onClick={handleSubmit}
              className="..."
            >
              Run
            </button>
```

to:

```tsx
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!qualityValid}
              className="... disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run
            </button>
```

(Preserve the existing className; append the two `disabled:` modifiers at the end.)

- [ ] **Step 6: Verify build + lint + tests**

```bash
npm run build && npm run lint && npm test
```

Expected: all three pass. Pre-existing `userActionLogger.test.ts:70` tsc error remains (unrelated to this branch); build does not fail on it because tsc is not part of `next build`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/components/chrome/SimSetupDrawer.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): wire Playback quality control into SimSetupDrawer

New "Playback quality" field (segmented picker + custom input + info
tooltip) sits between time-unit and the body list. Drawer owns the
qualityMultiplier state; useEffect on integrator change resets it to
that integrator's default (Euler→K=1, RK4→K=4, DP853→K=8). Submit
button disables while the custom input is invalid.

Submit payload now includes keyframeIntervalSec = qualityMultiplier ·
stepDtSeconds(timeStepUnit), populating the optional field added to
InitializeRequest in Phase 2. Backend already resolves + validates K
at the controller boundary.

Field component's label prop widened from string → React.ReactNode so
the tooltip icon can sit inline with the label text (strict widening;
all existing call sites unaffected).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Manual browser smoke test

No code changes. Verifies the UI end-to-end against a running backend.

- [ ] **Step 1: Confirm port 8080 is free, otherwise start backend on alternate port**

```bash
lsof -i :8080
```

If a process is using 8080: either ask the user to free it, or start the backend on `--server.port=8088` (Phase 2's manual verification used 8088 and worked). Remember to set `NEXT_PUBLIC_BACKEND_URL` accordingly if a non-default port is used — check `frontend/src/app/utils/backendUrls.ts` for how URLs are resolved.

If 8080 is free:

```bash
cd backend && ./mvnw spring-boot:run
```

Wait for `Started SpacesimApplication`.

- [ ] **Step 2: Start the frontend dev server**

```bash
cd frontend && npm run dev
```

Wait for `Ready in Xs`.

- [ ] **Step 3: Browser checklist**

In a browser at `http://localhost:3000`:

- Open the Sim Setup drawer.
- **Verify default by integrator:**
  - Default integrator is RK4 → "Medium" segment should be highlighted, custom input shows `4`.
  - Change integrator to Euler → "High" segment highlights, custom input shows `1`.
  - Change integrator to DP853 → "Med-Low" segment highlights, custom input shows `8`.
- **Verify preset clicks update state:**
  - With any integrator selected, click each preset (High → Low) → custom input value tracks (1, 2, 4, 8, 16).
- **Verify custom input changes preset highlight:**
  - Type `3` in custom input → no preset highlights (custom mode).
  - Type `4` → "Medium" highlights again.
- **Verify validation:**
  - Type `0` → red error text appears under the input ("Must be at least 1") and Run button disables (greys out, cursor-not-allowed).
  - Type `101` → red error text ("Must be at most 100") and Run button disables.
  - Type `abc` → error text ("Must be a whole number"), Run disabled.
  - Clear field → error text ("Enter a number"), Run disabled.
  - Type `4` → error clears, Run re-enables.
- **Verify tooltip:**
  - Hover the info icon next to "Playback quality" → tooltip appears with the explainer copy.
  - Tab focus to the info icon → tooltip appears (keyboard accessibility check).
- **Verify submit payload:**
  - With RK4 + Hours + Medium (default K=4), open DevTools → Network.
  - Click Run. Inspect the `/api/simulation/initialize` request body — should contain `"keyframeIntervalSec": 14400` (4 × 3600 seconds).
  - Switch to DP853 + Hours, picker auto-updates to Med-Low (multiplier 8). Click Run. Body should contain `"keyframeIntervalSec": 28800` (8 × 3600).
- **Verify end-to-end playback:**
  - With DP853 + Med-Low (K=8), after sim spins up, network tab shows `/chunk` payloads ~75% smaller than the K=1 reference from Phase 2 (~4MB → ~1MB range).
  - Scrub the timeline; playback looks smooth (Hermite interpolation hiding the thinning).
- **Verify no regression on the default flow:**
  - With the drawer untouched (RK4 + Hours + Medium default), playback looks indistinguishable from master. Stats.js / DevPanel FPS unchanged.

- [ ] **Step 4: Stop dev servers**

Ctrl-C the backend and frontend processes.

- [ ] **Step 5: Note any deviations**

If the browser checklist surfaces any UI bugs (wrong default, picker not highlighting, tooltip clipping, etc.), fix inline and re-run the affected checklist items. Commit fixes separately with descriptive messages so the PR history stays readable.

---

## Task 8: Push branch + open PR

- [ ] **Step 1: Final clean-state check**

```bash
git status
git log master..hermite-phase-3-ui --oneline
```

Expected: clean working tree; commit history matches the planned commits (1 plan + 5 implementation + N smoke-test fixes).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin hermite-phase-3-ui
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Hermite Phase 3: Playback quality UI" --body "$(cat <<'EOF'
## Summary
- New SimSetupDrawer "Playback quality" control — 5-preset segmented picker (High / Med-High / Medium / Med-Low / Low → multipliers 1/2/4/8/16) + custom numeric input + info tooltip + per-integrator defaults (Euler→K=1, RK4→K=4, DP853→K=8).
- Submit payload populates the optional `keyframeIntervalSec` field landed in Phase 2 (`= qualityMultiplier · stepDtSeconds(timeStepUnit)`). Backend already resolves + validates K at the controller boundary.
- Custom input clamped to [1, 100] (mirrors backend `MAX_KEYFRAMES_PER_KEPT`); invalid input disables the Run button.
- Sticky-override across integrator change is intentionally deferred (per spec).
- Hand-rolled picker + tooltip — no new dependencies (confirmed before planning).

## Test plan
- [x] `PlaybackQuality.test.ts`: 22+ cases covering preset table shape, monotonic multipliers, integrator-default integrity, stepDtSeconds conversion (all 4 units + case insensitivity + unknown-unit throw), getActivePresetKey (preset matches + custom-value null), parseCustomMultiplier (in-range + boundary + below-min + above-max + non-integer + empty + whitespace).
- [x] Existing frontend tests (Vitest): no regression.
- [x] `npm run build` + `npm run lint`: pass.
- [x] Manual browser smoke (see plan Task 7) — per-integrator defaults, preset clicks, custom input + validation, info tooltip, payload-in-DevTools, end-to-end playback at K=8.
- [ ] (Optional) If you want to test the validation against the live backend, deliberately type `101` in custom input and submit — should never reach the backend (Run button disabled).

Spec: `docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md` — Phase 3.
Plan: `docs/superpowers/plans/2026-05-18-hermite-phase-3-ui-surface.md`.

## Notable spec deviations (documented in plan)
- Picker is hand-rolled segmented buttons, not Radix `RadioGroup`. Avoids adding `@radix-ui/react-radio-group` for one control; matches the drawer's existing all-native pattern.
- Tooltip is a custom small component (CSS-only hover/focus visibility), not Radix tooltip. Same reason.
- Tests are pure-logic only — no jsdom + RTL infrastructure. Matches the existing frontend test pattern (vitest `environment: "node"`, zero `*.test.tsx` files today). UI verified by manual browser smoke per CLAUDE.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report the PR URL and stop**

Per `no-ci-polling.md`, do **not** wait for CI to finish or run `gh pr checks`. Print the PR URL and stop here. byeon will verify on GitHub and flag any failures.

---

## Self-review notes

- **Spec coverage:**
  - `PLAYBACK_QUALITY_PRESETS` constants ✓ (Task 2)
  - `INTEGRATOR_QUALITY_DEFAULTS` ✓ (Task 2)
  - SimSetupDrawer "Playback quality" field placement (under integrator + timeStepUnit) ✓ (Task 6 Step 4 inserts after time-unit)
  - Segmented radio with 5 preset buttons ✓ (Task 4) — deviation from Radix to hand-rolled, documented
  - Custom numeric input below segmented ✓ (Task 4)
  - Highlight active preset; "custom" implicit when no match ✓ (Task 4 via `getActivePresetKey`)
  - Integrator-change resets multiplier ✓ (Task 6 useEffect)
  - Custom input clamped [1, 100] + inline error ✓ (Task 4 + Task 2's `parseCustomMultiplier`)
  - Submit disabled while invalid ✓ (Task 6 Step 5)
  - Wire-up: `keyframeIntervalSec = qualityMultiplier · stepDtSeconds(timeStepUnit)` ✓ (Task 6 Step 3)
  - Info tooltip + spec copy ✓ (Task 3 + Task 6 Step 4)
  - Per-session-only persistence ✓ (no localStorage anywhere in this plan; state is `useState` in the drawer)
  - Tests: constants smoke + integrator-default validity ✓ (Task 2); SimSetupDrawer integration ✗ (intentional deviation — no jsdom; manual smoke covers it; documented in PR body)
- **Type consistency:** `multiplier` is a `number` throughout; `PlaybackQualityKey` is the discriminated union used in both the constants module and the picker. `keyframeIntervalSec` is `number` (not `Double` — that's the Java type) and optional on the request, mirroring the field added in Phase 2 (`initializeCelestialBodies.tsx`, `LastSimRequest`, `userActionLogger`'s selector type).
- **Out of scope:** sticky custom-value override (spec defers), mobile picker behavior (Phase 8), Radix tooltip / radio-group deps (rejected at design-decision phase).
