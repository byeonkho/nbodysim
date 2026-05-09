import React from "react";
import { useSelector } from "react-redux";
import { selectIsUpdating } from "@/app/store/slices/SimulationSlice";

// Center-of-screen "Fetching data..." overlay shown while the next chunk
// is in flight. Pointer-events default — the parent chrome wrapper sets
// pointer-events:none, so this overlay can't actually block clicks
// either way.
const UpdateModal: React.FC = () => {
  const isUpdating = useSelector(selectIsUpdating);

  if (!isUpdating) return null;

  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex items-center gap-3 rounded-md bg-black/70 text-white px-6 py-3 text-center"
    >
      {/* CSS-only spinner — 24px circle, 2px ring, accent-colored arc that
          rotates. Avoids pulling a spinner library for one indicator. */}
      <span
        className="inline-block h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin"
        aria-hidden="true"
      />
      <span className="text-base font-medium">Fetching data...</span>
    </div>
  );
};

export default UpdateModal;
