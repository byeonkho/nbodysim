// Client-side Sentry init. Next runs this module early on the client (before the
// app hydrates), so it's the earliest place to catch unhandled errors and promise
// rejections. Works in the static export build: it's plain client JS, no server.
//
// The DSN is inlined at build time from NEXT_PUBLIC_SENTRY_DSN. When it's unset
// (local dev, any unconfigured build) we skip init entirely, so Sentry is a silent
// no-op until the DSN is set on the Cloudflare Pages build env.
//
// Error tracking only: no performance tracing or session replay integrations are
// added, so there's nothing to sample and event volume stays within the free tier.
// React render-phase errors are swallowed by the route error boundaries and never
// reach the global handlers here, so error.tsx / global-error.tsx capture those
// explicitly.

import * as Sentry from "@sentry/react";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "production",
    sendDefaultPii: false,
  });
}
