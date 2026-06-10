"use client";

// Route-level error boundary. Catches render-phase errors anywhere in the page
// tree and shows a recoverable fallback instead of a blank white screen.
// (Errors thrown inside the R3F render loop / useFrame are outside React's
// render cycle and aren't caught here — this covers component render throws,
// e.g. a malformed chunk reaching a scene component, or a chrome crash.)

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App render error:", error);
  }, [error]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#07080e",
        color: "#e6e7ee",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: "#9a9db0", margin: "0 0 22px" }}>
          The simulation hit an unexpected snag. Reloading the page usually fixes
          it.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "1px solid rgba(196,200,255,0.85)",
              background: "linear-gradient(180deg, #c4c8ff 0%, #9298ee 100%)",
              color: "#16182a",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <button
            onClick={() => reset()}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "#e6e7ee",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
