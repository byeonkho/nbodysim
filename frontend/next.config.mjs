/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hide the Next.js dev-tools indicator (the floating "N" badge). It only
  // renders in development and never in a production build, so this is a
  // dev-experience tweak, not a deploy change.
  devIndicators: false,

  // Static export for Cloudflare Pages: the app is fully client-rendered (no
  // server features), so `next build` emits a plain `out/` of static files that
  // Pages serves directly, with no Node runtime.
  output: "export",

  // Static export can't run Next's image optimizer. The app only uses the
  // StaticImageData type (no <Image> component), so this is a no-op today; it
  // just keeps the build from ever tripping on an optimizer path.
  images: { unoptimized: true },

  compiler: {
    // Strip console.log/info/debug from production builds (keeps warn/error).
    // Drops the per-chunk decode timing log and any other dev noise from prod
    // without touching the diagnostics we actually want (console.error/warn).
    // Applies only to `next build`, so local dev logging is unaffected.
    removeConsole: { exclude: ["error", "warn"] },
  },
};

export default nextConfig;
