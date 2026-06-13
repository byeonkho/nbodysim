import { test, expect } from "@playwright/test";
import { journey } from "../lib/kit";

// Verifies spec 7b (chunk-fetch resilience) end to end in the real app, where
// the unit tests cannot reach: that a dead/transient chunk response actually
// surfaces the right toast, that transient failures retry on a GROWING backoff
// (not a per-frame flood) and recover, and that the attempt budget terminates
// with a run-again toast. We force the /chunk responses with route interception
// (the live backend still serves /initialize, so a real session exists and the
// thunk's stale-guard-passing path runs). Desktop-only: the retry logic is
// viewport-independent. failOnConsoleError is off because a 410/503 response
// legitimately makes the browser log a "Failed to load resource" console error.

const CHUNK = /\/api\/simulation\/chunk/;
const INITIALIZE = /\/api\/simulation\/initialize/;

// Dismiss the first-load intro tour so it does not intercept the builder.
async function dismissTour(page: import("@playwright/test").Page) {
  const tour = page.getByRole("dialog", { name: /intro tour/i });
  await tour.waitFor({ state: "visible" });
  const solo = tour.getByRole("button", { name: /explore solo/i });
  if (await solo.isVisible()) await solo.click();
  else await tour.getByRole("button", { name: "Skip" }).click();
}

// Open the builder and launch a live custom sim. Changing only the integrator
// (rk4 -> euler) breaks the exact-preset match so the request hits the live
// backend, while keeping the default bodies + epoch on the prebaked Horizons
// cache (no slow live JPL call).
async function launchLiveSim(j: import("../lib/kit").Journey) {
  await j.click('[data-testid="open-sim-setup"]');
  await j.waitFor('[data-testid="run-sim"]');
  await j.select('[data-testid="integrator-select"]', "euler");
  await j.click('[data-testid="run-sim"]');
}

journey(
  "a gone session (410) clears the session and shows a run-again toast",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();
    await dismissTour(j.page);

    // Force every chunk fetch to 410 Gone (the live backend still serves
    // /initialize, so a real session is established first).
    await j.page.route(CHUNK, (route) =>
      route.fulfill({
        status: 410,
        contentType: "application/json",
        body: "{}",
      }),
    );

    await launchLiveSim(j);

    await j.waitForRequest("POST", INITIALIZE, 200);
    await j.waitForRequest("POST", CHUNK, 410);

    // The 410 terminal path ran: the run-again toast is the user-visible proof
    // that the session was expired (this exact copy only fires on a 410). Match
    // the toast copy directly; getByRole("alert") also matches Next's hidden
    // route announcer, which is empty.
    await expect(
      j.page.getByText(/This simulation timed out\. Press Run to start it again\./i),
    ).toBeVisible();
    await j.screenshot("410-run-again-toast");

    // The prefetch loop is dead: the session was cleared, so no further chunk
    // fetch can be triggered. Count, wait, confirm it did not grow.
    const chunkCount = () =>
      j.requests().filter((r) => CHUNK.test(r.url)).length;
    const before = chunkCount();
    await j.page.waitForTimeout(3000);
    expect(
      chunkCount(),
      "no further chunk fetches after the session is expired",
    ).toBe(before);
  },
  { viewports: ["desktop"], failOnConsoleError: false },
);

journey(
  "a transient failure (503) retries on a growing backoff and then recovers",
  async (j) => {
    await j.goto("/");
    await j.waitForCanvas();
    await dismissTour(j.page);

    // Stamp each chunk request so we can prove the gaps GROW (exponential
    // backoff), not a fixed interval or a per-frame flood.
    const chunkTimes: number[] = [];
    j.page.on("request", (req) => {
      if (CHUNK.test(req.url())) chunkTimes.push(Date.now());
    });

    // First two chunk fetches fail with 503; the rest hit the real backend.
    let failsLeft = 2;
    await j.page.route(CHUNK, (route) => {
      if (failsLeft > 0) {
        failsLeft -= 1;
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        });
      } else {
        route.continue();
      }
    });

    await launchLiveSim(j);

    await j.waitForRequest("POST", INITIALIZE, 200);
    // The backoff timer drives the retries (no playback needed), and the third
    // attempt succeeds against the live backend.
    await j.waitForRequest("POST", CHUNK, 200, { timeoutMs: 15000 });

    // The scene painted from the recovered chunk: the retry actually healed the
    // stream, it did not just back off and die.
    await j.page.waitForTimeout(1500);
    await j.expectCanvasPainted();
    await j.screenshot("503-recovered-and-painted");

    // The give-up toast must NOT have appeared (we recovered before the budget).
    await expect(
      j.page.getByText(/Could not reach the simulator/i),
    ).toHaveCount(0);

    // Gaps grow: the second retry waited longer than the first (2s vs 1s).
    expect(
      chunkTimes.length,
      "expected at least 3 chunk attempts (initial + 2 retries)",
    ).toBeGreaterThanOrEqual(3);
    const gap1 = chunkTimes[1] - chunkTimes[0];
    const gap2 = chunkTimes[2] - chunkTimes[1];
    expect(
      gap2,
      `backoff should grow: gap2 (${gap2}ms) > gap1 (${gap1}ms)`,
    ).toBeGreaterThan(gap1 * 1.4);
  },
  { viewports: ["desktop"], failOnConsoleError: false },
);

journey(
  "a persistent failure backs off (no flood) and gives up with a run-again toast",
  async (j) => {
    // The full budget is ~1+2+4+8+16 = 31s of backoff before give-up.
    test.setTimeout(70_000);

    await j.goto("/");
    await j.waitForCanvas();
    await dismissTour(j.page);

    const chunkTimes: number[] = [];
    j.page.on("request", (req) => {
      if (CHUNK.test(req.url())) chunkTimes.push(Date.now());
    });

    // Every chunk fetch fails with 503, forever.
    await j.page.route(CHUNK, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    );

    await launchLiveSim(j);
    await j.waitForRequest("POST", INITIALIZE, 200);

    // Wait out the whole backoff budget plus a margin.
    await j.page.waitForTimeout(34_000);

    // Give-up is terminal and user-visible.
    await expect(
      j.page.getByText(/Could not reach the simulator\. Press Run to try again\./i),
    ).toBeVisible();
    await j.screenshot("503-give-up-toast");

    // The decisive anti-hammer assertion: a per-frame retry would fire hundreds
    // of requests in 31s; a bounded exponential backoff fires a handful. The
    // attempt budget is 5, so initial + 5 retries = 6 (allow slack for timing).
    expect(
      chunkTimes.length,
      `bounded backoff, not a per-frame flood (got ${chunkTimes.length} attempts)`,
    ).toBeLessThanOrEqual(8);
    expect(chunkTimes.length).toBeGreaterThanOrEqual(4);

    // And those few attempts spread out (last gap >> first gap).
    const firstGap = chunkTimes[1] - chunkTimes[0];
    const lastGap =
      chunkTimes[chunkTimes.length - 1] - chunkTimes[chunkTimes.length - 2];
    expect(
      lastGap,
      `backoff widened: last gap (${lastGap}ms) > first gap (${firstGap}ms)`,
    ).toBeGreaterThan(firstGap);
  },
  { viewports: ["desktop"], failOnConsoleError: false },
);
