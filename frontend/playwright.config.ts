import { defineConfig, devices } from "@playwright/test";

// Journeys only live in e2e/journeys. Underscore-prefixed specs (the copy-me
// template) are ignored so they never run as tests.
export default defineConfig({
  testDir: "./e2e/journeys",
  testIgnore: ["**/_*.spec.ts"],
  // global-setup boots (or attaches to) the isolated stack and returns the
  // teardown. Path is relative to this config file.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false, // one stack shared across journeys; keep it simple
  reporter: [["list"], ["html", { outputFolder: "e2e/.artifacts/report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile-iphone",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
