"use client";

import React from "react";

// Composition root for the mobile guided-explorer chrome. Filled in by
// later tasks (control sheet, body sheet, auto-run). Stub renders a marker
// so Task 2 can verify the desktop/mobile branch swaps at the breakpoint.
export function MobileChrome() {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-xs text-white backdrop-blur">
      mobile chrome
    </div>
  );
}
