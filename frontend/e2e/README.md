# Frontend e2e journeys

Headless full-stack verification: drive the real frontend, screenshot the UI,
assert the backend effect. The 3D canvas is not pixel-diffed (headless WebGL is
software-rendered and the scene is animated), but a journey can assert it
actually painted (`j.expectCanvasPainted()`, a readPixels not-blank check) and
that it drew the right content (`j.sceneStats()` exposes the live body count),
so a blank scene fails loudly instead of passing silently.

## What it is (and isn't) for

Reach for a journey when the thing you changed is only true in a real browser:

- **Interaction and layering** (its sweet spot): pointer-events / z-index
  stacking, focus traps, scroll capture, overlay hit-testing, safe-area /
  viewport behaviour. These are invisible to unit tests and easy to get wrong in
  code review (an overlay wrapper that silently eats a tap, a tab order that
  double-fires). If a finding involves "what is actually on top and clickable",
  write the journey alongside the fix, not after.
- **Backend effects**: the network calls an interaction triggers and the backend
  log lines it produces.
- **Canvas liveness**: that the scene painted and drew the expected bodies (not
  pixel regression).

Do **not** use it for logic a vitest unit test already covers, or to assert the
exact rendered pixels of the 3D scene.

## Install (once)

    npm run e2e:install   # downloads headless Chromium + WebKit

(The mobile-iphone project runs on WebKit, so both engines are needed.)

## Run

- Full hermetic pass (boots an isolated backend + frontend on free alt ports,
  runs every journey under desktop + mobile, tears down):

      npm run e2e

- Fast JIT loop (boot a warm stack once, re-run one journey against it):

      npm run e2e:stack                                      # terminal 1, leave running (or background)
      E2E_ATTACH=1 npm run e2e -- e2e/journeys/<one>.spec.ts # terminal 2, repeat

  `E2E_ATTACH=1` is the attach signal that `global-setup` reads. (A bare
  `--attach` flag is rejected by current Playwright as an unknown option before
  global-setup runs, so use the env var.) The warm stack is a long-lived
  process: it prints `[e2e:stack] ready` and writes `.artifacts/stack.json`,
  then stays up. If you launch it in the background, wait for that ready marker
  (or for `stack.json` to exist) before attaching, not for the process to exit.

- The first run builds the backend jar. After backend changes, force a rebuild:

      E2E_REBUILD=1 npm run e2e

  `E2E_REBUILD` only applies to a fresh boot. A warm stack started with
  `npm run e2e:stack` keeps the jar it booted with, so after a backend change
  restart the warm stack (with `E2E_REBUILD=1`) rather than expecting an
  attach run to pick up the new backend.

Artifacts (gitignored) land in `e2e/.artifacts/`: `screenshots/`, `backend.log`,
`frontend.log`, `report/` (Playwright HTML report), `stack.json`.

Screenshots land at `e2e/.artifacts/screenshots/<journey name>/<step>.<viewport>.png`.

## Write a journey

Copy `journeys/_template.spec.ts`. A journey is `journey(name, async (j) => { ... }, opts?)`.

### Vocabulary

| Call | What it does |
|------|--------------|
| `j.goto(path)` | Navigate to a path on the local dev server (e.g. `"/"`). |
| `j.click(sel)` | Click a CSS/Playwright selector. |
| `j.fill(sel, v)` | Type a value into an input. |
| `j.select(sel, v)` | Choose an option in a `<select>` element. |
| `j.press(key)` | Press a keyboard key (e.g. `"Enter"`, `"Escape"`). |
| `j.waitFor(sel)` | Wait until a selector is visible in the DOM. |
| `j.waitForCanvas()` | Wait until the 3D canvas is mounted with nonzero size. |
| `j.screenshot(name)` | Save a screenshot to `.artifacts/screenshots/<journey>/<name>.<viewport>.png`. |
| `j.expectRequest(method, urlPattern, status?)` | Synchronous assertion: the request already happened and is in the log. Use for requests that fire before your first interaction. |
| `await j.waitForRequest(method, urlPattern, status?)` | Async poll: waits until a matching request appears. Use right after an interaction that triggers a request. |
| `j.expectNoRequest(method, urlPattern)` | Assert no matching request has been recorded. |
| `j.requests()` | Return the raw array of captured requests for custom assertions. |
| `await j.expectLog(re)` | Wait until a log line matching the regex appears in the backend log. |
| `await j.expectNoLog(re)` | Assert no matching log line appears (settles after a brief wait). |
| `j.page` | Raw Playwright `Page` object, for anything the kit does not expose. |
| `j.context` | Raw Playwright `BrowserContext` object. |

### Options

`journey(name, fn, { viewports: ["desktop"] })` restricts which viewports run.
`journey(name, fn, { failOnConsoleError: false })` tolerates browser console
errors on a known-noisy path. Both default: run desktop and mobile, fail on
console error.

## Gotchas and constraints

- **First-load intro tour:** the tour overlay can intercept clicks on the app
  chrome, and the autorun clip advances the tour state machine so the dismiss
  button reads "I'll explore solo" or "Skip". Dismiss it before interacting
  with the builder (see the template for the exact snippet).

- **Backend journeys, Horizons cache:** keep bodies and epoch at their defaults
  when writing a journey that runs a custom sim. The default bodies and epoch
  are served from a prebaked Horizons cache (fast, offline). Any other
  combination triggers a live JPL Horizons network call (slow, flaky in CI).
  Changing a param like the integrator is fine and is the correct way to force
  the live backend path instead of an offline preset clip.

- **`expectRequest` vs `waitForRequest`:** `expectRequest` is a synchronous
  "already happened" check. `waitForRequest` polls and is what you want right
  after a click that triggers a request. Using `expectRequest` on a request
  that has not fired yet will fail immediately.

- **Dev mode, not a prod build:** the stack boots the Next.js dev server for
  fast startup. Known dev-vs-prod gaps (e.g. extra console noise) are expected
  and are not test failures unless `failOnConsoleError` is true (the default).

- **Enter does not reliably activate a focused button headless:** a synthetic
  Enter on a focused `<button>` does NOT consistently fire the button's native
  click in headless Chromium (sometimes it does, sometimes not, run to run).
  Synthetic clicks and typing are reliable; this one pairing is not. So a bug
  that hinges on the keydown + native-click pair, e.g. a window-level keydown
  handler double-firing alongside a button's own activation, cannot be pinned by
  a stable journey assertion (no single expectation passes on the fixed code and
  fails on the buggy code). Verify that class of keyboard-activation bug
  manually. Mouse-driven interactions and form input remain solid.
