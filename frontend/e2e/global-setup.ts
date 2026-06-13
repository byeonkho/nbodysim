import {
  bootStack,
  writeStackFile,
  readStackFile,
  removeStackFile,
} from "./lib/stack";

// Two modes:
// - Attach (E2E_ATTACH set, e.g. `npm run e2e -- --attach`): a warm stack from
//   `npm run e2e:stack` is already running; reuse its stack.json and DO NOT
//   tear it down (this process does not own it).
// - Hermetic (default): boot a fresh isolated stack, persist its handle, and
//   return a teardown that stops it. Playwright runs the returned function once
//   after all tests.
async function globalSetup(): Promise<(() => Promise<void>) | void> {
  const attach = process.argv.includes("--attach") || !!process.env.E2E_ATTACH;

  if (attach) {
    const info = readStackFile();
    if (!info) {
      throw new Error(
        "--attach: no e2e/.artifacts/stack.json. Start one first: npm run e2e:stack",
      );
    }
    const health = await fetch(`${info.backendUrl}/actuator/health`).catch(
      () => null,
    );
    if (!health || !health.ok) {
      throw new Error(`--attach: stack at ${info.backendUrl} is not reachable`);
    }
    return; // do not tear down a stack we do not own
  }

  const stack = await bootStack();
  writeStackFile(stack.info);
  return async () => {
    stack.stop();
    removeStackFile();
  };
}

export default globalSetup;
