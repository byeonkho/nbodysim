import { describe, it, expect } from "vitest";
import { matchResponse, type RecordedResponse } from "./network";

const log: RecordedResponse[] = [
  { method: "POST", url: "http://localhost:18080/api/simulation/initialize", status: 200 },
  { method: "POST", url: "http://localhost:18080/api/simulation/chunk", status: 200 },
  { method: "GET", url: "http://localhost:13001/_next/static/x.js", status: 200 },
];

describe("matchResponse", () => {
  it("matches by method and url substring", () => {
    expect(matchResponse(log, "POST", "/api/simulation/initialize")).toBeTruthy();
  });
  it("matches by regex", () => {
    expect(matchResponse(log, "POST", /\/api\/simulation\/chunk/)).toBeTruthy();
  });
  it("respects the status filter", () => {
    expect(matchResponse(log, "POST", "/initialize", 200)).toBeTruthy();
    expect(matchResponse(log, "POST", "/initialize", 500)).toBeUndefined();
  });
  it("is method-sensitive", () => {
    expect(matchResponse(log, "GET", "/api/simulation/initialize")).toBeUndefined();
  });
  it("returns undefined when nothing matches", () => {
    expect(matchResponse(log, "POST", "/api/simulation/ground-truth")).toBeUndefined();
  });
});
