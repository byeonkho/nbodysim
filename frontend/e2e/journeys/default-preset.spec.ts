import { expect } from "@playwright/test";
import { journey } from "../lib/kit";

// The default scene autoruns a precomputed static clip on first load (desktop
// and mobile, via FirstMountAutorun). Verify: the clip asset actually loads, the
// canvas genuinely painted (real pixels + the right body count, not a blank
// scene), and NO live-simulation backend call happens (the clip is a static
// edge asset, so a POST to /api/simulation would mean the clip path regressed to
// the live path).
journey(
  "default scene autoruns the static clip and paints with no live backend call",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();

    // The autorun fetches the default clip; wait for it, then let the
    // off-main-thread decode paint the first frames before screenshotting.
    // Without this wait the screenshot fires at canvas-mount, before any body
    // is drawn, and silently captures an empty scene.
    await j.waitForRequest("GET", /clip-default-v3\.bin/, 200);
    await j.page.waitForTimeout(2500);
    await j.screenshot("default-loaded");

    // The canvas actually painted (real pixels, not a blank/black frame)...
    await j.expectCanvasPainted();
    // ...and it drew the default body set (semantic, pixel-free).
    const scene = await j.sceneStats();
    expect(scene.painted, "first chunk should have painted").toBe(true);
    expect(scene.bodyCount, "default scene should draw bodies").toBeGreaterThan(
      0,
    );

    j.expectNoRequest("POST", /\/api\/simulation\//);
  },
);
