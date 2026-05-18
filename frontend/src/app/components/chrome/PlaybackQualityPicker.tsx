"use client";

import { useState } from "react";
import {
  PLAYBACK_QUALITY_PRESETS,
  type PlaybackQualityKey,
  getActivePresetKey,
  parseCustomMultiplier,
} from "@/app/constants/PlaybackQuality";

/**
 * Controlled picker for the keyframe-thinning lever. Single source of
 * truth for the resolved value is the parent-owned `multiplier` number.
 * The picker derives which preset (if any) to highlight via
 * getActivePresetKey, and uses an "override" pattern (rather than a
 * useEffect that resets local state on prop change) to satisfy the
 * react-hooks/set-state-in-effect lint rule:
 *
 *   - On every user keystroke in the custom input we store
 *     `{ prevMultiplier, raw, error }`. The override is only "active"
 *     when prevMultiplier === current multiplier prop.
 *   - When the parent changes multiplier externally (e.g., integrator
 *     reset) OR the user clicks a preset, multiplier changes → the
 *     stored override's prevMultiplier no longer matches → override
 *     is ignored and customRaw derives from the prop.
 *
 * The parent's integrator-change effect is responsible for also resetting
 * qualityValid → true, so the picker never needs an effect to clear a
 * stale invalid state after an external multiplier change.
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

  const [override, setOverride] = useState<{
    prevMultiplier: number;
    raw: string;
    error: string | null;
  } | null>(null);

  const overrideActive = override !== null && override.prevMultiplier === multiplier;
  const customRaw = overrideActive ? override!.raw : String(multiplier);
  const customError = overrideActive ? override!.error : null;

  const handlePresetClick = (key: PlaybackQualityKey) => {
    onChange(PLAYBACK_QUALITY_PRESETS[key].multiplier);
    onValidityChange(true);
  };

  const handleCustomChange = (raw: string) => {
    const result = parseCustomMultiplier(raw);
    if (result.error !== null) {
      // Pin override to current multiplier so it stays "active" through
      // this re-render — preserves the invalid string + error message.
      setOverride({ prevMultiplier: multiplier, raw, error: result.error });
      onValidityChange(false);
      return;
    }
    // Valid: pin override to the new resolved value. Next render's
    // multiplier prop will equal result.value (parent's onChange fires),
    // so override remains "active" and customRaw shows exactly what the
    // user typed (preserves leading zeros, trailing whitespace, etc.).
    setOverride({ prevMultiplier: result.value, raw, error: null });
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
          className="text-hi w-16 rounded-md border border-white/[0.08] bg-transparent px-2 py-1 text-[12px] outline-none focus:border-white/[0.20]"
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
