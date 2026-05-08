"use client";

import { BodyCard } from "@/app/components/chrome/BodyCard";
import { EventLogCard } from "@/app/components/chrome/EventLogCard";

// Right-column composition: body card on top, event log below. Width 316,
// from below the top status strip to above the bottom timeline.

export function RightColumn() {
  return (
    <div
      className="pointer-events-auto absolute top-[128px] right-6 flex w-[316px] flex-col gap-3"
      style={{ bottom: 114 }}
    >
      <BodyCard />
      <EventLogCard />
    </div>
  );
}
