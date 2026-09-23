import { expect } from "@playwright/test";
import { journey } from "../lib/kit";
import { readStackFile } from "../lib/stack";

journey("cross origin rate limits expose their retry delay", async (j) => {
  await j.goto("/");
  const backendUrl = readStackFile()!.backendUrl;
  const result = await j.page.evaluate(async (base) => {
    let response: Response | undefined;
    // Invalid bodies exercise the real limiter without initializing simulations.
    for (let i = 0; i < 21; i++) {
      response = await fetch(`${base}/api/simulation/initialize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "198.51.100.34",
        },
        body: "{}",
      });
      if (response.status === 429) break;
      await response.text();
    }
    return {
      status: response!.status,
      retryAfter: response!.headers.get("Retry-After"),
      body: await response!.json(),
    };
  }, backendUrl);
  expect(result.status).toBe(429);
  expect(Number(result.retryAfter)).toBeGreaterThan(0);
  expect(Number(result.retryAfter)).toBe(result.body.retryAfterSeconds);
  await j.expectLog(/Rate limit hit/);
}, { viewports: ["desktop"], failOnConsoleError: false });
