import React from "react";
import { useSelector } from "react-redux";
import {
  selectHasReceivedFirstChunk,
  selectSessionID,
} from "@/app/store/slices/SimulationSlice";

// Shown only between "user clicked Run" (sessionID present) and "first chunk
// landed" (hasReceivedFirstChunk == true). After that, prefetches are silent —
// no modal flashes between chunks like the old UpdateModal did.
const FirstLoadSpinner: React.FC = () => {
  const sessionID = useSelector(selectSessionID);
  const hasFirst = useSelector(selectHasReceivedFirstChunk);

  if (!sessionID || hasFirst) return null;

  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex items-center gap-3 rounded-md bg-black/70 text-white px-6 py-3 text-center"
    >
      <span
        className="inline-block h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin"
        aria-hidden="true"
      />
      <span className="text-base font-medium">Loading simulation…</span>
    </div>
  );
};

export default FirstLoadSpinner;
