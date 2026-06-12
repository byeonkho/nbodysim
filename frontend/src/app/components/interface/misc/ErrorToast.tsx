"use client";

import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/app/store/Store";
import { clearErrorMessage } from "@/app/store/slices/RequestSlice";

// Bottom-center error toast. Replaces MUI's Snackbar/Alert. Auto-dismisses
// after 6s on each new errorMessage; the manual close button fires the
// same clear action.
const AUTO_HIDE_MS = 6000;

const ErrorToast: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const errorMessage = useSelector(
    (state: RootState) => state.request.errorMessage,
  );

  useEffect(() => {
    if (errorMessage === null) return;
    const id = window.setTimeout(() => {
      dispatch(clearErrorMessage());
    }, AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [errorMessage, dispatch]);

  if (errorMessage === null) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed left-1/2 z-50 -translate-x-1/2 pointer-events-auto flex items-center gap-3 min-w-[300px] rounded-md bg-red-600 px-4 py-3 text-sm font-medium text-white shadow-lg"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
    >
      <span className="grow">{errorMessage}</span>
      <button
        type="button"
        onClick={() => dispatch(clearErrorMessage())}
        aria-label="Dismiss error"
        className="text-white/80 hover:text-white text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
};

export default ErrorToast;
