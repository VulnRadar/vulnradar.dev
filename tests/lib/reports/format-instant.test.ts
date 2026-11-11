import { afterEach, describe, expect, it } from "vitest";
import {
  formatReportDate,
  formatReportDateTime,
  formatReportTime,
} from "@/lib/reports/format-instant";

const originalTz = process.env.TZ;

function inZone(zone: string, run: () => void) {
  process.env.TZ = zone;
  run();
}

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("format-instant", () => {
  const instant = "2026-01-15T23:30:00Z";

  it("names the date and the zone for a late-evening UTC instant", () => {
    expect(formatReportDate(instant)).toBe("January 15, 2026");
    expect(formatReportTime(instant)).toBe("11:30 PM UTC");
    expect(formatReportDateTime(instant)).toBe(
      "January 15, 2026, 11:30 PM UTC",
    );
  });

  it("gives the same text whatever zone the machine is in", () => {
    for (const zone of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
      inZone(zone, () => {
        expect(formatReportDateTime(instant)).toBe(
          "January 15, 2026, 11:30 PM UTC",
        );
        expect(formatReportDate(instant)).toBe("January 15, 2026");
      });
    }
  });

  it("adds the weekday and the seconds only when asked", () => {
    expect(formatReportDate(instant, { weekday: true })).toBe(
      "Thursday, January 15, 2026",
    );
    expect(formatReportTime("2026-01-15T10:05:09Z", { seconds: true })).toBe(
      "10:05:09 AM UTC",
    );
  });

  it("accepts a Date and keeps midnight on the right day", () => {
    expect(formatReportDateTime(new Date("2026-03-01T00:00:00Z"))).toBe(
      "March 1, 2026, 12:00 AM UTC",
    );
  });

  it("answers Unknown for a missing or unparseable instant", () => {
    expect(formatReportDateTime(undefined)).toBe("Unknown");
    expect(formatReportDateTime(null)).toBe("Unknown");
    expect(formatReportDateTime("")).toBe("Unknown");
    expect(formatReportDate("not a date")).toBe("Unknown");
    expect(formatReportTime("not a date")).toBe("Unknown");
  });
});
