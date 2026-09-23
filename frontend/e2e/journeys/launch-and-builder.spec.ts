import { expect } from "@playwright/test";
import { journey } from "../lib/kit";

journey("builder controls have visible accessible labels", async (j) => {
  await j.goto("/");
  const tour = j.page.getByRole("dialog", { name: /intro tour/i });
  await tour.waitFor({ state: "visible" });
  const solo = tour.getByRole("button", { name: /explore solo/i });
  if (await solo.isVisible()) await solo.click();
  else await tour.getByRole("button", { name: "Skip" }).click();
  const desktop = await j.page.getByTestId("open-sim-setup").isVisible();
  if (desktop) await j.page.getByTestId("open-sim-setup").click();
  else await j.page.getByRole("button", { name: "Build simulation" }).click();
  const builder = j.page.getByRole("dialog", { name: "Configure simulation" });
  for (const name of [
    "Epoch",
    "Reference frame",
    "Integrator",
    desktop ? "Time unit" : "Time step",
  ]) {
    const control = builder.getByLabel(name, { exact: true });
    await expect(control).toHaveCount(1);
    await expect(control).toHaveAccessibleName(name);
    await j.page.keyboard.press("Tab");
    await control.focus();
    await expect(control).toBeFocused();
    const outline = await control.evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: getComputedStyle(element).outlineWidth,
    }));
    expect(outline.style, name).toBe("solid");
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  }
  await builder.getByLabel("Integrator", { exact: true }).selectOption("euler");
  await expect(builder.getByLabel("Integrator", { exact: true })).toHaveValue(
    "euler",
  );
  await j.screenshot("named-builder-controls");
});

journey(
  "a delayed desktop launch cannot replace a newer mobile clip",
  async (j) => {
    await j.goto("/");
    const tour = j.page.getByRole("dialog", { name: /intro tour/i });
    await tour.waitFor({ state: "visible" });
    const solo = tour.getByRole("button", { name: /explore solo/i });
    if (await solo.isVisible()) await solo.click();
    else await tour.getByRole("button", { name: "Skip" }).click();
    let release!: () => void;
    let entered!: () => void;
    let finished!: () => void;
    const blocked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settled = new Promise<void>((resolve) => {
      finished = resolve;
    });
    const chunks: string[] = [];
    j.page.on("request", (request) => {
      if (request.url().endsWith("/chunk")) chunks.push(request.url());
    });
    await j.page.route("**/api/simulation/initialize", async (route) => {
      const response = await route.fetch();
      entered();
      await held;
      try {
        await route.fulfill({ response });
      } finally {
        finished();
      }
    });
    try {
      await j.page.getByTestId("open-sim-setup").click();
      await j.page
        .getByLabel("Integrator", { exact: true })
        .selectOption("euler");
      await j.page.getByTestId("run-sim").click();
      await blocked;
      await j.page.setViewportSize({ width: 390, height: 664 });
      await j.page
        .getByRole("dialog", { name: /intro tour/i })
        .getByRole("button", { name: "Skip" })
        .click();
      await j.page.getByRole("button", { name: "Build simulation" }).click();
      await j.page
        .getByRole("button", { name: "Run simulation", exact: true })
        .click();
      await expect(
        j.page.getByRole("dialog", { name: "Configure simulation" }),
      ).toBeHidden();
      release();
      await settled;
      await j.page.setViewportSize({ width: 1280, height: 800 });
      await j.page.keyboard.press("Escape");
      await expect(
        j.page.getByRole("dialog", { name: "Configure simulation" }),
      ).toBeHidden();
      await expect(
        j.page.getByRole("button", { name: "Open sim setup", exact: true }),
      ).toContainText(/Integrator:\s*RK4/);
      await j.expectCanvasPainted();
      expect(chunks).toHaveLength(0);
      await j.screenshot("newer-clip-keeps-ownership");
    } finally {
      release();
    }
  },
  { viewports: ["desktop"] },
);

journey(
  "a failed replacement resumes the retained first chunk",
  async (j) => {
    await j.goto("/");
    const tour = j.page.getByRole("dialog", { name: /intro tour/i });
    await tour.waitFor({ state: "visible" });
    const solo = tour.getByRole("button", { name: /explore solo/i });
    if (await solo.isVisible()) await solo.click();
    else await tour.getByRole("button", { name: "Skip" }).click();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chunkRequests: { sessionID: string; expectedChunkIndex: number }[] =
      [];
    await j.page.route("**/api/simulation/chunk", async (route) => {
      chunkRequests.push(route.request().postDataJSON());
      if (chunkRequests.length === 1) {
        await held;
        await route.abort();
      } else await route.continue();
    });
    try {
      await j.page.getByTestId("open-sim-setup").click();
      await j.page
        .getByLabel("Integrator", { exact: true })
        .selectOption("euler");
      await j.page.getByTestId("run-sim").click();
      await expect.poll(() => chunkRequests.length).toBe(1);
      await expect(
        j.page.getByRole("dialog", { name: "Configure simulation" }),
      ).toBeHidden();

      // Reject before reaching the backend so the old session remains live,
      // matching input validation or a gateway rejecting the replacement.
      await j.page.route("**/api/simulation/initialize", (route) =>
        route.fulfill({ status: 400 }),
      );
      await j.page.getByTestId("open-sim-setup").click();
      await j.page.getByTestId("run-sim").click();
      await expect.poll(() => chunkRequests.length).toBeGreaterThanOrEqual(2);
      expect(chunkRequests[1]).toEqual(chunkRequests[0]);
      await j.waitForRequest("POST", /\/chunk$/, 200);
      await j.expectLog(/Chunk served in/);
      await j.page.keyboard.press("Escape");
      await j.expectCanvasPainted();
      await j.screenshot("retained-stream-recovered");
    } finally {
      release();
    }
  },
  { viewports: ["desktop"], failOnConsoleError: false },
);
