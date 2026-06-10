"use client";

import { BodyCard } from "@/app/components/chrome/BodyCard";

// Right-column composition: just the body card now, top-right. The event log
// used to stack below it here; it docks bottom-left above the timeline instead
// (mounted in Layout). Width 316, below the top status strip.

export function RightColumn() {
  return (
    <div
      data-tour="info-card"
      className="pointer-events-auto absolute top-[148px] right-6 w-[316px]"
    >
      <BodyCard />
    </div>
  );
}
