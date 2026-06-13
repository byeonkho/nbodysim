import { journey } from "../lib/kit";

// The default scene plays from a precomputed static clip: it must NOT touch the
// backend. Verifies boot + render + UI chrome at both viewports.
journey("default scene plays from the static clip with no backend calls", async (j) => {
  await j.goto("/");
  await j.waitForCanvas();
  await j.screenshot("default-loaded");

  // Give any (unexpected) backend call a moment to fire before asserting none did.
  await j.page.waitForTimeout(1500);
  j.expectNoRequest("POST", /\/api\/simulation\//);
});
