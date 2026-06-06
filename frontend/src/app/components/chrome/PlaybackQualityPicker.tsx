"use client";

import {
  BUCKET_LABELS,
  FIDELITY_BUCKETS,
  type FidelityBucket,
} from "@/app/constants/PlaybackQuality";

/**
 * Controlled segmented picker for the fidelity bucket. Single source of
 * truth is the parent-owned {@code bucket} prop.
 *
 * <p>4 hand-rolled {@code <button>} elements form the segmented control,
 * matching the drawer's existing custom-component pattern (BodySphere,
 * ToggleSwitch). No custom-value input — the bucket abstraction is the
 * user-facing axis; backend per-integrator resolution does the rest.
 */
export function PlaybackQualityPicker({
  bucket,
  onChange,
}: {
  bucket: FidelityBucket;
  onChange: (bucket: FidelityBucket) => void;
}) {
  return (
    <div
      className="flex overflow-hidden rounded-lg border border-white/[0.08]"
      role="radiogroup"
      aria-label="Playback quality preset"
    >
      {FIDELITY_BUCKETS.map((key, i, arr) => {
        const isActive = bucket === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(key)}
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
            {BUCKET_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}
