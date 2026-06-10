"use client";

// Last-resort boundary: catches errors in the root layout itself (which the
// route-level error.tsx cannot). Must render its own <html>/<body> because it
// replaces the whole document, so styles are inline.

import { useEffect } from "react";
import * as Sentry from "@sentry/react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App fatal error:", error);
    // Last-resort boundary; the error is swallowed here and never reaches the
    // global handlers, so report it explicitly. No-op when Sentry is disabled.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#07080e",
            color: "#e6e7ee",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 10px" }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: "#9a9db0", margin: "0 0 22px" }}>
              The page failed to load. Reloading usually fixes it.
            </p>
            <button
              onClick={() => reset()}
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
          </div>
        </div>
      </body>
    </html>
  );
}
