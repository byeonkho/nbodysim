import {
  test,
  expect,
  type Page,
  type BrowserContext,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { matchResponse, type RecordedResponse } from "./network";
import { tailSize, readTail } from "./logTail";
import { readStackFile, type StackInfo } from "./stack";

const ARTIFACTS = path.resolve(__dirname, "..", ".artifacts");

export interface JourneyOpts {
  // Restrict which viewport projects this journey runs under. Default: both.
  viewports?: ("desktop" | "mobile")[];
  // Fail the journey if the page logs a console error. Default: true.
  failOnConsoleError?: boolean;
}

// The vocabulary an author uses. A new JIT journey calls these on `j`; for
// anything missing, `j.page` is the raw Playwright Page.
export class Journey {
  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    private readonly stack: StackInfo,
    private readonly responses: RecordedResponse[],
    private readonly logStartOffset: number,
    private readonly name: string,
    private readonly viewport: string,
  ) {}

  async goto(p: string): Promise<void> {
    await this.page.goto(this.stack.frontendUrl + p, {
      waitUntil: "domcontentloaded",
    });
  }
  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }
  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }
  async select(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }
  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }
  async waitFor(selector: string): Promise<void> {
    await this.page.waitForSelector(selector);
  }
  // The 3D canvas is treated as an opaque box: confirm it mounted with a real
  // size. Never pixel-diffed (headless WebGL is software-rendered + animated).
  async waitForCanvas(): Promise<void> {
    const canvas = this.page.locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    const box = await canvas.boundingBox();
    expect(box, "canvas should have a bounding box").not.toBeNull();
    expect(box!.width, "canvas width > 0").toBeGreaterThan(0);
    expect(box!.height, "canvas height > 0").toBeGreaterThan(0);
  }
  async screenshot(name: string): Promise<void> {
    const dir = path.join(ARTIFACTS, "screenshots", this.name);
    fs.mkdirSync(dir, { recursive: true });
    await this.page.screenshot({
      path: path.join(dir, `${name}.${this.viewport}.png`),
    });
  }
  // Assert the page made a backend request matching method + url (+ status).
  expectRequest(
    method: string,
    urlPattern: string | RegExp,
    status?: number,
  ): RecordedResponse {
    const match = matchResponse(this.responses, method, urlPattern, status);
    expect(
      match,
      `expected a ${method} ${String(urlPattern)}${status ? ` -> ${status}` : ""} request`,
    ).toBeTruthy();
    return match!;
  }
  // Wait until the page makes a backend request matching method + url (+ status),
  // polling the recorded responses. Use this after an interaction that triggers a
  // request (click resolves before the response arrives). expectRequest is the
  // synchronous "already happened" variant.
  async waitForRequest(
    method: string,
    urlPattern: string | RegExp,
    status?: number,
    opts: { timeoutMs?: number } = {},
  ): Promise<RecordedResponse> {
    const timeoutMs = opts.timeoutMs ?? 10000;
    const deadline = Date.now() + timeoutMs;
    let match = matchResponse(this.responses, method, urlPattern, status);
    while (!match && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      match = matchResponse(this.responses, method, urlPattern, status);
    }
    expect(
      match,
      `expected a ${method} ${String(urlPattern)}${status ? ` -> ${status}` : ""} request within ${timeoutMs}ms`,
    ).toBeTruthy();
    return match!;
  }
  expectNoRequest(method: string, urlPattern: string | RegExp): void {
    const match = matchResponse(this.responses, method, urlPattern);
    expect(
      match,
      `did not expect a ${method} ${String(urlPattern)} request`,
    ).toBeFalsy();
  }
  requests(): RecordedResponse[] {
    return this.responses;
  }
  // Assert the backend log (only the tail written since this journey started)
  // matches `re`. Polls because logging is slightly async vs the HTTP response.
  async expectLog(re: RegExp, opts: { timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (opts.timeoutMs ?? 5000);
    let tail = "";
    while (Date.now() < deadline) {
      tail = readTail(this.stack.backendLogPath, this.logStartOffset);
      if (re.test(tail)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(re.test(tail), `backend log should match ${re}; tail was:\n${tail.slice(-500)}`).toBe(true);
  }
  // Assert the backend log does NOT contain `re`. Waits a short settle window
  // first so a not-yet-flushed line has time to appear (logging lags the HTTP
  // response), then checks the tail once.
  async expectNoLog(re: RegExp, opts: { settleMs?: number } = {}): Promise<void> {
    await new Promise((r) => setTimeout(r, opts.settleMs ?? 750));
    const tail = readTail(this.stack.backendLogPath, this.logStartOffset);
    expect(
      re.test(tail),
      `backend log should NOT match ${re}; tail was:\n${tail.slice(-500)}`,
    ).toBe(false);
  }
}

// Register a journey. Runs under both viewport projects unless opts.viewports
// restricts it. Records every response + console error and captures the backend
// log watermark before running the author's steps.
export function journey(
  name: string,
  fn: (j: Journey) => Promise<void>,
  opts: JourneyOpts = {},
): void {
  test(name, async ({ page, context }, testInfo: TestInfo) => {
    const viewport = testInfo.project.name.startsWith("mobile")
      ? "mobile"
      : "desktop";
    if (opts.viewports && !opts.viewports.includes(viewport)) {
      test.skip(true, `journey restricted to ${opts.viewports.join("/")}`);
    }

    const stack = readStackFile();
    if (!stack) throw new Error("no stack.json; global-setup did not run");

    const responses: RecordedResponse[] = [];
    page.on("response", (res) => {
      responses.push({
        method: res.request().method(),
        url: res.url(),
        status: res.status(),
      });
    });
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const logStartOffset = tailSize(stack.backendLogPath);
    const j = new Journey(
      page,
      context,
      stack,
      responses,
      logStartOffset,
      name,
      viewport,
    );
    await fn(j);

    if (opts.failOnConsoleError !== false) {
      expect(
        consoleErrors,
        `unexpected console errors:\n${consoleErrors.join("\n")}`,
      ).toEqual([]);
    }
  });
}
