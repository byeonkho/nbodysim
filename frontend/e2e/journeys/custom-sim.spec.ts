import { journey } from "../lib/kit";

// Building a custom sim (a config that does NOT match any preset clip) hits the
// backend: POST /initialize then POST /chunk. We change ONLY the integrator
// (rk4 -> euler), keeping the default bodies + epoch, so every body is served
// from the prebaked Horizons cache and no live JPL Horizons call happens.
// Desktop-only: the Run code path is shared across viewports.
journey(
  "custom sim reaches the backend and the backend logs the run",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();

    // Dismiss the first-load intro tour so it does not intercept the builder.
    // The tour may still be on the welcome step ("I'll explore solo") or, if
    // the autorun clip has already started and advanced it to phase2, the
    // overlay will show "Skip" instead. Both buttons call skipTour(). We scope
    // to the tour dialog and click whichever dismiss control is present.
    const tourDialog = j.page.getByRole("dialog", { name: /intro tour/i });
    await tourDialog.waitFor({ state: "visible" });
    const exploreBtn = tourDialog.getByRole("button", { name: /explore solo/i });
    const skipBtn = tourDialog.getByRole("button", { name: "Skip" });
    if (await exploreBtn.isVisible()) {
      await exploreBtn.click();
    } else {
      await skipBtn.click();
    }

    await j.click('[data-testid="open-sim-setup"]');
    await j.waitFor('[data-testid="run-sim"]');
    await j.screenshot("builder-open");

    // Break the exact-preset match without changing the cached body set/epoch.
    await j.select('[data-testid="integrator-select"]', "euler");
    await j.click('[data-testid="run-sim"]');

    // The live launch path fired (use waitForRequest: the click resolves before
    // the responses arrive).
    await j.waitForRequest("POST", /\/api\/simulation\/initialize/, 200);
    await j.waitForRequest("POST", /\/api\/simulation\/chunk/, 200);

    // The backend actually ran the simulation.
    await j.expectLog(/Simulation completed for/);

    await j.screenshot("sim-running");
  },
  { viewports: ["desktop"] },
);
