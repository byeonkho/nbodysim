import { journey } from "../lib/kit";

// Spec 10 / L16: on the mobile intro tour's build step, the spotlighted FAB
// must be tappable (the full-screen capturer is pointer-through on spotlighted
// steps), and tapping it must open the builder AND finish the tour for good
// (the z-[60] overlay unmounts so it cannot re-block the z-50 builder). A prior
// version swallowed the tap; another reappeared when the builder closed. This
// journey drives the real mobile tour to the build step, taps the glowing FAB,
// and asserts both effects in the live WebKit app.
//
// Mobile-only: the build FAB, spotlight, and mobile tour overlay only render on
// the mobile chrome. The 3D canvas is opaque here; we assert DOM state, not
// pixels.
journey(
  "mobile tour build step: tapping the spotlighted FAB opens the builder and dismisses the tour",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();

    // The mobile tour is local-state and shows once the first chunk is buffered
    // (the autorun clip provides it) on a fresh visit (no localStorage). It is
    // NOT advanced by the autorun, so it sits on the welcome step until we tap.
    const tour = j.page.getByRole("dialog", { name: "Intro tour" });
    await tour.waitFor({ state: "visible" });
    await j.screenshot("tour-welcome");

    // welcome -> inspect -> gestures -> build (3 Next taps). Wait for each step's
    // eyebrow so we advance deterministically rather than on a fixed delay.
    const nextBtn = tour.getByRole("button", { name: "Next" });
    await nextBtn.click(); // -> inspect
    await tour.getByText("Tip", { exact: true }).waitFor({ state: "visible" });
    await nextBtn.click(); // -> gestures
    await tour
      .getByText("Move around", { exact: true })
      .waitFor({ state: "visible" });
    await nextBtn.click(); // -> build
    await tour
      .getByText("Build your own", { exact: true })
      .waitFor({ state: "visible" });
    await j.screenshot("tour-build-step");

    // The capturer is z-[60] above the FAB. If L16 regressed (pointerEvents
    // "auto" on the spotlight step) this click would land on the capturer and
    // the builder would never open, failing the assertion below.
    const fab = j.page.getByRole("button", { name: "Build simulation" });
    await fab.click();

    // (a) the builder opened
    const builderTitle = j.page.getByText("Configure simulation", {
      exact: true,
    });
    await builderTitle.waitFor({ state: "visible" });

    // (b) the tour is gone (finished latched -> overlay unmounted), so the
    //     z-[60] capturer no longer blocks the builder.
    await tour.waitFor({ state: "hidden" });
    await j.screenshot("builder-open-tour-gone");
  },
  { viewports: ["mobile"] },
);
