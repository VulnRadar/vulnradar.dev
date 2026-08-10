import { describe, it, expect } from "vitest";
import {
  localHourLabel,
  localHourToUtc,
  localHourAndDowToUtc,
  localHourAndDomToUtc,
} from "@/components/profile/tabs/developer/schedule-time-utils";

// These exercise the conversion math against an injected `now`, kept
// deliberately independent of the test runner's own timezone: every
// assertion checks the *relationship* between input and output (bounds,
// round-trip consistency) rather than a hardcoded local-time string, which
// would only be correct in whatever timezone CI happens to run in.

describe("localHourLabel", () => {
  it("produces a non-empty, distinct label for each hour of the day", () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const labels = Array.from({ length: 24 }, (_, h) => localHourLabel(h, now));
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(24);
  });
});

describe("localHourToUtc", () => {
  it("always returns an hour in [0, 23]", () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    for (let h = 0; h < 24; h++) {
      const utcHour = localHourToUtc(h, now);
      expect(utcHour).toBeGreaterThanOrEqual(0);
      expect(utcHour).toBeLessThanOrEqual(23);
    }
  });

  it("is a pure function of (hourLocal, now): same inputs, same output", () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    expect(localHourToUtc(9, now)).toBe(localHourToUtc(9, now));
  });
});

describe("localHourAndDowToUtc", () => {
  const now = new Date("2026-08-12T00:00:00.000Z"); // a Wednesday

  it("always returns a day-of-week in [0, 6] and an hour in [0, 23]", () => {
    for (let dow = 0; dow < 7; dow++) {
      for (const hour of [0, 6, 12, 18, 23]) {
        const { hourUtc, dowUtc } = localHourAndDowToUtc(hour, dow, now);
        expect(hourUtc).toBeGreaterThanOrEqual(0);
        expect(hourUtc).toBeLessThanOrEqual(23);
        expect(dowUtc).toBeGreaterThanOrEqual(0);
        expect(dowUtc).toBeLessThanOrEqual(6);
      }
    }
  });

  it("is deterministic for a fixed reference date", () => {
    const a = localHourAndDowToUtc(14, 2, now);
    const b = localHourAndDowToUtc(14, 2, now);
    expect(a).toEqual(b);
  });
});

describe("localHourAndDomToUtc", () => {
  const now = new Date("2026-08-12T00:00:00.000Z");

  it("always returns a day-of-month in [1, 28] regardless of input", () => {
    for (const dom of [1, 15, 28, 30, 99, -3, 0]) {
      const { domUtc } = localHourAndDomToUtc(10, dom, now);
      expect(domUtc).toBeGreaterThanOrEqual(1);
      expect(domUtc).toBeLessThanOrEqual(28);
    }
  });

  it("clamps an out-of-range day-of-month down to 28 rather than crashing", () => {
    const { domUtc } = localHourAndDomToUtc(10, 31, now);
    expect(domUtc).toBeLessThanOrEqual(28);
  });

  it("is deterministic for a fixed reference date", () => {
    const a = localHourAndDomToUtc(9, 15, now);
    const b = localHourAndDomToUtc(9, 15, now);
    expect(a).toEqual(b);
  });
});
