import { bootStack, writeStackFile, removeStackFile } from "./stack";

// Boots a long-lived isolated stack and writes its coordinates to
// .artifacts/stack.json, then holds until Ctrl-C. Use this for the JIT loop:
//   npm run e2e:stack            # leave running in one terminal / background
//   npm run e2e -- --attach ...  # re-run a single journey against it, fast
async function main() {
  const stack = await bootStack();
  writeStackFile(stack.info);
  // eslint-disable-next-line no-console
  console.log(
    `\n[e2e:stack] ready\n  frontend: ${stack.info.frontendUrl}\n  backend:  ${stack.info.backendUrl}\n  log:      ${stack.info.backendLogPath}\n  attach:   npm run e2e -- --attach\n  (Ctrl-C to stop)\n`,
  );
  const shutdown = () => {
    stack.stop();
    removeStackFile();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[e2e:stack] failed:", err);
  process.exit(1);
});
