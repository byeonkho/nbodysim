import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const FRONTEND_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const ARTIFACTS = path.join(FRONTEND_DIR, "e2e", ".artifacts");
const STACK_FILE = path.join(ARTIFACTS, "stack.json");

// Serialized to .artifacts/stack.json so the kit (a separate test process) and
// teardown can find the live stack.
export interface StackInfo {
  frontendUrl: string;
  backendUrl: string;
  backendPort: number;
  frontendPort: number;
  backendLogPath: string;
  backendPid: number;
  frontendPid: number;
}

export class Stack {
  constructor(
    readonly info: StackInfo,
    private readonly backend: ChildProcess,
    private readonly frontend: ChildProcess,
  ) {}

  stop(): void {
    for (const proc of [this.frontend, this.backend]) {
      if (proc.pid && !proc.killed) {
        try {
          // Negative pid kills the whole process group (next/java spawn children).
          process.kill(-proc.pid, "SIGTERM");
        } catch {
          try {
            proc.kill("SIGTERM");
          } catch {
            // already gone
          }
        }
      }
    }
  }
}

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      const srv = net.createServer();
      srv.once("error", () => {
        srv.close();
        if (port - start > 200) reject(new Error("no free port found"));
        else tryPort(port + 1);
      });
      srv.once("listening", () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

async function waitForHttp(url: string, label: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms`);
}

function findBootJar(): string | null {
  const target = path.join(BACKEND_DIR, "target");
  if (!fs.existsSync(target)) return null;
  const jars = fs
    .readdirSync(target)
    .filter((f) => f.endsWith(".jar") && !f.endsWith(".original"));
  return jars.length ? path.join(target, jars[0]) : null;
}

function ensureJar(): string {
  let jar = findBootJar();
  // Build when no jar exists, or when E2E_REBUILD is set to force a fresh build
  // after backend changes. (v1 keeps this simple instead of mtime-diffing src.)
  if (!jar || process.env.E2E_REBUILD) {
    const mvnw = path.join(BACKEND_DIR, "mvnw");
    const build = spawnSync(mvnw, ["-q", "-DskipTests", "package"], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
    });
    if (build.status !== 0) throw new Error("backend jar build failed");
    jar = findBootJar();
  }
  if (!jar) throw new Error("no bootable backend jar found after build");
  return jar;
}

// Boot an isolated backend + frontend on free alt ports, capture backend stdout
// to a log file, and wait until both are reachable.
export async function bootStack(): Promise<Stack> {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const backendPort = await findFreePort(18080);
  const frontendPort = await findFreePort(13001);
  const backendUrl = `http://localhost:${backendPort}`;
  const frontendUrl = `http://localhost:${frontendPort}`;
  const backendLogPath = path.join(ARTIFACTS, "backend.log");
  const frontendLogPath = path.join(ARTIFACTS, "frontend.log");

  const jar = ensureJar();

  // The fat jar cannot resolve classpath: URIs for the Orekit data directory, so
  // we must pass the extracted path on disk. Use target/classes (built alongside
  // the jar) or fall back to src/main/resources (always present in the checkout).
  const orekitInTarget = path.join(BACKEND_DIR, "target", "classes", "orekit-data-master");
  const orekitInSrc = path.join(BACKEND_DIR, "src", "main", "resources", "orekit-data-master");
  const orekitDataPath = fs.existsSync(orekitInTarget) ? orekitInTarget : orekitInSrc;

  const backendLog = fs.openSync(backendLogPath, "w");
  const backend = spawn("java", ["-jar", jar, `--server.port=${backendPort}`], {
    cwd: BACKEND_DIR,
    env: { ...process.env, OREKIT_DATA_PATH: orekitDataPath },
    stdio: ["ignore", backendLog, backendLog],
    detached: true,
  });
  await waitForHttp(`${backendUrl}/actuator/health`, "backend");

  const frontendLog = fs.openSync(frontendLogPath, "w");
  const frontend = spawn(
    "npm",
    ["run", "dev", "--", "-p", String(frontendPort)],
    {
      cwd: FRONTEND_DIR,
      env: { ...process.env, NEXT_PUBLIC_BACKEND_URL: backendUrl },
      stdio: ["ignore", frontendLog, frontendLog],
      detached: true,
    },
  );
  await waitForHttp(frontendUrl, "frontend");

  const info: StackInfo = {
    frontendUrl,
    backendUrl,
    backendPort,
    frontendPort,
    backendLogPath,
    backendPid: backend.pid!,
    frontendPid: frontend.pid!,
  };
  return new Stack(info, backend, frontend);
}

export function writeStackFile(info: StackInfo): void {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(STACK_FILE, JSON.stringify(info, null, 2));
}

export function readStackFile(): StackInfo | null {
  try {
    return JSON.parse(fs.readFileSync(STACK_FILE, "utf8")) as StackInfo;
  } catch {
    return null;
  }
}

export function removeStackFile(): void {
  try {
    fs.rmSync(STACK_FILE);
  } catch {
    // already gone
  }
}

export const STACK_FILE_PATH = STACK_FILE;
