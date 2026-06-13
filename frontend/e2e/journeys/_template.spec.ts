import { journey } from "../lib/kit";

// COPY ME. Rename to <feature>.spec.ts and delete what you do not need.
// Fast JIT loop against a warm stack:
//   npm run e2e:stack                                          (terminal 1, leave running)
//   E2E_ATTACH=1 npm run e2e -- e2e/journeys/<feature>.spec.ts (terminal 2, repeat)
journey("describe the path you are verifying", async (j) => {
  await j.goto("/");
  await j.waitForCanvas();

  // If your path touches the app chrome, the first-load intro tour can
  // intercept clicks. Dismiss it first:
  //   const tour = j.page.getByRole("dialog", { name: /intro tour/i });
  //   await tour.waitFor({ state: "visible" });
  //   const solo = tour.getByRole("button", { name: /explore solo/i });
  //   if (await solo.isVisible()) await solo.click();
  //   else await tour.getByRole("button", { name: "Skip" }).click();

  // await j.click('[data-testid="..."]');
  // await j.select('[data-testid="..."]', "value");
  await j.screenshot("step-name");

  // If the path hits the backend, keep bodies + epoch at their defaults so the
  // prebaked Horizons cache serves them (no slow live JPL call). Use
  // waitForRequest (not expectRequest) for requests triggered by an interaction:
  // await j.waitForRequest("POST", /\/api\/simulation\/initialize/, 200);
  // await j.expectLog(/Simulation completed for/);

  // Escape hatch for anything the kit lacks: await j.page.locator("...").hover();
});
