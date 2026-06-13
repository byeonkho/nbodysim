import { describe, expect, it } from "vitest";
import {
  daysSinceJ2000,
  formatJD,
  formatTPlus,
  formatTimeStep,
  isoToDateOrNull,
  julianDate,
  timeStepSeconds,
} from "./dateMath";

// Astronomical constants (silent-failure territory: a wrong epoch
// constant or an off-by-one in the JD ↔ Unix conversion would render
// the entire status strip subtly wrong without crashing).

const J2000 = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
const J2000_PLUS_1_DAY = new Date(Date.UTC(2000, 0, 2, 12, 0, 0));
const J2000_MINUS_1_DAY = new Date(Date.UTC(1999, 11, 31, 12, 0, 0));

describe("julianDate", () => {
  it("anchors J2000 epoch at JD 2451545.0", () => {
    expect(julianDate(J2000)).toBeCloseTo(2451545.0, 6);
  });

  it("advances exactly 1 JD per UTC day", () => {
    expect(julianDate(J2000_PLUS_1_DAY)).toBeCloseTo(2451546.0, 6);
  });

  it("decreases for pre-J2000 dates", () => {
    expect(julianDate(J2000_MINUS_1_DAY)).toBeCloseTo(2451544.0, 6);
  });

  it("anchors UNIX epoch at JD 2440587.5", () => {
    // Jan 1 1970 00:00 UTC — well-known reference value
    expect(julianDate(new Date(0))).toBeCloseTo(2440587.5, 6);
  });
});

describe("daysSinceJ2000", () => {
  it("returns 0 at J2000 epoch", () => {
    expect(daysSinceJ2000(J2000)).toBe(0);
  });

  it("counts +1 day forward", () => {
    expect(daysSinceJ2000(J2000_PLUS_1_DAY)).toBe(1);
  });

  it("returns negative for pre-J2000", () => {
    expect(daysSinceJ2000(J2000_MINUS_1_DAY)).toBe(-1);
  });

  it("handles 24-year span across leap years correctly", () => {
    // Jan 1 2024 12:00 UTC → 2000–2024 spans 24 years × 365 + 6 leap days
    // (2000, 2004, 2008, 2012, 2016, 2020) before Jan 1 2024.
    const t = new Date(Date.UTC(2024, 0, 1, 12, 0, 0));
    expect(daysSinceJ2000(t)).toBe(24 * 365 + 6);
  });
});

// U+202F (narrow no-break space) is used for digit grouping — preferred
// over a regular space so the number doesn't break across lines.
const NNBSP = " ";

describe("formatJD", () => {
  it("groups thousands with narrow no-break space and 5-decimal fractional", () => {
    expect(formatJD(2460478.79167)).toBe(`2${NNBSP}460${NNBSP}478.79167`);
  });

  it("pads short fractional with zeros", () => {
    expect(formatJD(2451545)).toBe(`2${NNBSP}451${NNBSP}545.00000`);
  });

  it("returns em-dash for non-finite input", () => {
    expect(formatJD(Number.NaN)).toBe("—");
    expect(formatJD(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("carries into the whole part when fraction rounds to 1.00000", () => {
    // jd = 2451544.9999951: raw frac.toFixed(5) rounds to "1.00000", so the
    // whole part must carry to 2451545, not stay at 2451544.
    expect(formatJD(2451544.9999951)).toBe(`2${NNBSP}451${NNBSP}545.00000`);
  });
});

describe("formatTPlus", () => {
  it("renders zero days at J2000 itself", () => {
    expect(formatTPlus(J2000)).toBe("T+0 d");
  });

  it("uses + sign and narrow-space grouping for forward dates", () => {
    // 8929 d after J2000 ≈ Jun 12 2024 12:00 UTC
    const t = new Date(J2000.getTime() + 8929 * 86_400_000);
    expect(formatTPlus(t)).toBe(`T+8${NNBSP}929 d`);
  });

  it("uses minus sign (U+2212) for pre-J2000 dates", () => {
    expect(formatTPlus(J2000_MINUS_1_DAY)).toBe("T−1 d");
  });

  it("floors fractional days", () => {
    // 1.7 days after J2000 → still T+1 d (full days only)
    const t = new Date(J2000.getTime() + 1.7 * 86_400_000);
    expect(formatTPlus(t)).toBe("T+1 d");
  });
});

describe("timeStepSeconds", () => {
  it("maps known units", () => {
    expect(timeStepSeconds("Seconds")).toBe(1);
    expect(timeStepSeconds("Hours")).toBe(3600);
    expect(timeStepSeconds("Days")).toBe(86_400);
    expect(timeStepSeconds("Weeks")).toBe(604_800);
  });

  it("falls back to 3600 for unknown / undefined", () => {
    expect(timeStepSeconds(undefined)).toBe(3600);
    expect(timeStepSeconds("Fortnights")).toBe(3600);
  });
});

describe("formatTimeStep", () => {
  it("formats hours with narrow-space grouping", () => {
    expect(formatTimeStep("Hours")).toBe(`3${NNBSP}600 s`);
  });

  it("formats days", () => {
    expect(formatTimeStep("Days")).toBe(`86${NNBSP}400 s`);
  });

  it("formats seconds without grouping", () => {
    expect(formatTimeStep("Seconds")).toBe("1 s");
  });
});

describe("isoToDateOrNull", () => {
  it("parses a valid ISO string", () => {
    const d = isoToDateOrNull("2024-06-05T00:00:00.000");
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
  });

  it("returns null for empty string", () => {
    expect(isoToDateOrNull("")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(isoToDateOrNull("not-a-date")).toBeNull();
  });
});
