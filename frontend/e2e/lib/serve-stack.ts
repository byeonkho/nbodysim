import { bootStack, writeStackFile, removeStackFile } from "./stack";

// Boots a long-lived isolated stack and writes its coordinates to
// .artifacts/stack.json, then holds until Ctrl-C. Use this for the JIT loop:
//   npm run e2e:stack                  # leave running in one terminal / background
//   E2E_ATTACH=1 npm run e2e -- <spec>  # re-run a single journey against it, fast
async function main() {
  const stack = await bootStack();
  writeStackFile(stack.info);
  console.log(
    `\n[e2e:stack] ready\n  frontend: ${stack.info.frontendUrl}\n  backend:  ${stack.info.backendUrl}\n  log:      ${stack.info.backendLogPath}\n  attach:   E2E_ATTACH=1 npm run e2e -- <spec>\n  (Ctrl-C to stop)\n`,
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
  console.error("[e2e:stack] failed:", err);
  process.exit(1);
});
