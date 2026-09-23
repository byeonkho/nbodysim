import { expect } from "@playwright/test";
import { journey } from "../lib/kit";

journey(
  "reference snapshots recover after a rapid paused rewind",
  async (j) => {
    const calls: number[][] = [];
    j.page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/ground-truth")
      ) {
        calls.push(request.postDataJSON().referenceEpochs);
      }
    });
    await j.goto("/");
    await j.waitForCanvas();
    const tour = j.page.getByRole("dialog", { name: /intro tour/i });
    await tour.waitFor({ state: "visible" });
    const solo = tour.getByRole("button", { name: /explore solo/i });
    if (await solo.isVisible()) await solo.click();
    else await tour.getByRole("button", { name: "Skip" }).click();
    await j.waitForRequest("GET", /clip-default-v4-science2\.bin/, 200);
    await j.page.getByRole("button", { name: "Pause", exact: true }).click();
    await j.page
      .locator('[data-tour="body-selector"]')
      .getByRole("button", { name: "Mercury", exact: true })
      .click();
    await j.page.getByRole("button", { name: "Drift", exact: true }).click();
    await j.waitForRequest("POST", /\/ground-truth$/, 200);
    await expect(
      j.page.getByText("Snapshot difference", { exact: true }),
    ).toBeVisible();
    await expect(
      j.page
        .getByText("Off by", { exact: true })
        .locator("..")
        .locator("span")
        .last(),
    ).toHaveText(/^[\d,.]+(?:M)? km$/);
    expect(calls[0].length).toBeLessThanOrEqual(2000);
    expect(calls[0][1] - calls[0][0]).toBe(36_000_000); // every 10-hour saved snapshot
    await j.page
      .getByText("Snapshot difference", { exact: true })
      .scrollIntoViewIfNeeded();
    await j.page.mouse.move(30, 650);
    await j.screenshot("matching-snapshot-reference");

    const track = j.page
      .locator("div.touch-none.select-none")
      .filter({ has: j.page.locator('svg[height="32"]') });
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    // Seek far enough to replace the initial reference window, then rewind
    // while paused and within the fetch throttle interval.
    await j.page.mouse.click(box!.x + box!.width * 0.85, box!.y + 16);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    await j.page.mouse.click(box!.x + box!.width * 0.01, box!.y + 16);
    await expect
      .poll(() => calls.length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(3);
    const latest = calls[calls.length - 1];
    expect(latest[0]).toBeLessThan(calls[1][0]);
    await expect(
      j.page
        .getByText("Off by", { exact: true })
        .locator("..")
        .locator("span")
        .last(),
    ).toHaveText(/^[\d,.]+(?:M)? km$/);
    await expect(
      j.page.getByRole("button", { name: "Play", exact: true }),
    ).toBeVisible();
    await j.expectCanvasPainted();
    await j.page
      .getByText("Snapshot difference", { exact: true })
      .scrollIntoViewIfNeeded();
    await j.screenshot("paused-rewind-reference-restored");
  },
  { viewports: ["desktop"] },
);
