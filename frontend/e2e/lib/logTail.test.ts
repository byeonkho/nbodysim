import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tailSize, readTail } from "./logTail";

let file: string;
beforeEach(() => {
  file = path.join(os.tmpdir(), `logtail-${process.pid}-${Math.floor(performance.now())}.log`);
});
afterEach(() => {
  if (fs.existsSync(file)) fs.rmSync(file);
});

describe("tailSize", () => {
  it("returns 0 for a missing file", () => {
    expect(tailSize(file)).toBe(0);
  });
  it("returns the byte size of an existing file", () => {
    fs.writeFileSync(file, "abc");
    expect(tailSize(file)).toBe(3);
  });
});

describe("readTail", () => {
  it("reads only bytes written after the offset", () => {
    fs.writeFileSync(file, "first line\n");
    const offset = tailSize(file);
    fs.appendFileSync(file, "Simulation completed for 8760 Hours\n");
    const tail = readTail(file, offset);
    expect(tail).toContain("Simulation completed for");
    expect(tail).not.toContain("first line");
  });
  it("returns empty string when nothing was appended", () => {
    fs.writeFileSync(file, "only line\n");
    const offset = tailSize(file);
    expect(readTail(file, offset)).toBe("");
  });
  it("returns empty string for a missing file", () => {
    expect(readTail(file, 0)).toBe("");
  });
});
