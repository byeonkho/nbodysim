import fs from "node:fs";

// Byte size of a log file, or 0 if it does not exist yet. Used to capture a
// watermark at journey start so assertions only see lines emitted during the
// journey (a warm stack accumulates lines across journeys).
export function tailSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// Read the slice of the file from `fromOffset` to end as utf-8. Returns "" if
// the file is gone or nothing was appended.
export function readTail(filePath: string, fromOffset: number): string {
  let fd: number | undefined;
  try {
    const size = fs.statSync(filePath).size;
    if (size <= fromOffset) return "";
    fd = fs.openSync(filePath, "r");
    const length = size - fromOffset;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, fromOffset);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
