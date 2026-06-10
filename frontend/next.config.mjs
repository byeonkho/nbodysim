/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the Next.js dev-tools indicator (the floating "N" badge). It only
  // renders in development and never in a production build, so this is a
  // dev-experience tweak, not a deploy change.
  devIndicators: false,

  compiler: {
    // Strip console.log/info/debug from production builds (keeps warn/error).
    // Drops the per-chunk decode timing log and any other dev noise from prod
    // without touching the diagnostics we actually want (console.error/warn).
    // Applies only to `next build`, so local dev logging is unaffected.
    removeConsole: { exclude: ["error", "warn"] },
  },
};

export default nextConfig;
