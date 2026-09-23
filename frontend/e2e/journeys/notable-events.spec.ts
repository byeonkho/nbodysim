import { expect } from "@playwright/test";
import { journey } from "../lib/kit";

// Notable events: the precomputed default clip autoruns with NO backend call,
// its decode triggers the client-side event scanner, and detected events render
// as clickable marker pips on the timeline scrubber. This journey verifies the
// DOM integration the unit tests cannot see: that markers actually render as
// positioned, clickable elements on the real scrubber, and that clicking one is
// accepted (pointer-events layering is correct). Detection math, narration, and
// dedup are covered by the vitest suites.

// Marker pips are buttons whose aria-label carries the plain-English event
// phrase ("X is closest to Y", "X is nearest the Sun", "X is farthest from ...").
const MARKER_SEL =
  'button[aria-label*="closest to"], button[aria-label*="nearest the Sun"], button[aria-label*="farthest from"]';

journey(
  "notable events: scrubber markers render and are clickable",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();

    // Dismiss the first-load intro tour so it does not intercept chrome clicks.
    const tour = j.page.getByRole("dialog", { name: /intro tour/i });
    try {
      await tour.waitFor({ state: "visible", timeout: 6000 });
      const solo = tour.getByRole("button", { name: /explore solo/i });
      if (await solo.isVisible()) await solo.click();
      else await tour.getByRole("button", { name: /skip/i }).click();
    } catch {
      // Tour may be absent on this run; continue.
    }

    // Autorun loads the static clip; wait for it, then let the off-main-thread
    // decode + the event scan run before querying for markers.
    await j.waitForRequest("GET", /clip-default-v4-science2\.bin/, 200);
    await j.page.waitForTimeout(3000);

    const markers = j.page.locator(MARKER_SEL);
    const count = await markers.count();
    console.log(`[notable-events] scrubber marker count = ${count}`);
    await j.screenshot("markers-on-scrubber");

    expect(
      count,
      "the default clip should surface at least one notable-event marker on the scrubber",
    ).toBeGreaterThan(0);

    // The pips sit in a pointer-events-none overlay but are themselves
    // pointer-events-auto, so they must be clickable. Clicking one seeks the
    // scrubber; confirm the click is accepted against the first marker.
    await markers.first().click();
    await j.page.waitForTimeout(500);
    await j.screenshot("after-marker-click");
  },
  { viewports: ["desktop"] },
);
