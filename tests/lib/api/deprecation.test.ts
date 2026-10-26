import { describe, expect, it } from "vitest";

import {
  MIGRATION_GUIDE_PATH,
  addCalendarMonths,
  currentSchedule,
  deprecationHeaders,
  retired,
  retirementDetails,
  retirementMessage,
  successorLink,
  type DeprecationSchedule,
} from "@/lib/api/deprecation";
import { buildError } from "@/lib/api/error-envelope";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const iso = (date: Date) => date.toISOString();

describe("addCalendarMonths", () => {
  it("adds six months to 2026-11-01 and lands on 2027-05-01, which is 181 days", () => {
    const start = new Date("2026-11-01T00:00:00.000Z");
    const end = addCalendarMonths(start, 6);
    expect(iso(end)).toBe("2027-05-01T00:00:00.000Z");
    expect((end.getTime() - start.getTime()) / DAY).toBe(181);
  });

  it("clamps to the last day of a shorter month instead of rolling over", () => {
    expect(iso(addCalendarMonths("2026-08-31T00:00:00.000Z", 6))).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2027-08-31T00:00:00.000Z", 6))).toBe(
      "2028-02-29T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-01-31T00:00:00.000Z", 1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-03-31T00:00:00.000Z", 1))).toBe(
      "2026-04-30T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2024-02-29T00:00:00.000Z", 12))).toBe(
      "2025-02-28T00:00:00.000Z",
    );
  });

  it("keeps the time of day", () => {
    expect(iso(addCalendarMonths("2026-11-01T13:45:10.123Z", 6))).toBe(
      "2027-05-01T13:45:10.123Z",
    );
  });

  it("carries across a year boundary in both directions", () => {
    expect(iso(addCalendarMonths("2026-09-15T00:00:00.000Z", 6))).toBe(
      "2027-03-15T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-12-10T00:00:00.000Z", 1))).toBe(
      "2027-01-10T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-03-31T00:00:00.000Z", -1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-02-10T00:00:00.000Z", -13))).toBe(
      "2025-01-10T00:00:00.000Z",
    );
    expect(iso(addCalendarMonths("2026-05-05T00:00:00.000Z", 0))).toBe(
      "2026-05-05T00:00:00.000Z",
    );
  });

  it("accepts a Date, a timestamp or an ISO string, and does not mutate a Date", () => {
    const date = new Date("2026-11-01T00:00:00.000Z");
    const expected = "2027-05-01T00:00:00.000Z";
    expect(iso(addCalendarMonths(date, 6))).toBe(expected);
    expect(iso(addCalendarMonths(date.getTime(), 6))).toBe(expected);
    expect(iso(addCalendarMonths("2026-11-01", 6))).toBe(expected);
    expect(iso(date)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("refuses an unreadable date or a fractional month count", () => {
    expect(() => addCalendarMonths("not a date", 6)).toThrow(RangeError);
    expect(() => addCalendarMonths(Number.NaN, 6)).toThrow(RangeError);
    expect(() => addCalendarMonths("2026-11-01", 1.5)).toThrow(RangeError);
    expect(() => addCalendarMonths("2026-11-01", Number.NaN)).toThrow(
      RangeError,
    );
  });

  it("makes six calendar months 181 to 184 days for any start, so a 183 day assertion would be wrong", () => {
    const seen = new Set<number>();
    for (let offset = 0; offset < 4 * 366; offset++) {
      const start = new Date(Date.UTC(2026, 0, 1) + offset * DAY);
      const days =
        (addCalendarMonths(start, 6).getTime() - start.getTime()) / DAY;
      expect(days).toBeGreaterThanOrEqual(181);
      expect(days).toBeLessThanOrEqual(184);
      seen.add(days);
    }
    expect(Math.min(...seen)).toBe(181);
  });
});

const SUNSET = "2027-05-01T00:00:00.000Z";
const SCHEDULE: DeprecationSchedule = {
  deprecatedAt: "2026-11-01T00:00:00.000Z",
  sunset: SUNSET,
  brownouts: [
    { from: "2027-04-17T10:00:00.000Z", to: "2027-04-17T11:00:00.000Z" },
    { from: "2027-04-24T10:00:00.000Z", to: "2027-04-24T11:00:00.000Z" },
  ],
};
const sunsetMs = Date.parse(SUNSET);

describe("retired", () => {
  it("is false whenever enforcement is off, at any date, including long after the Sunset", () => {
    for (const now of [
      0,
      Date.parse(SCHEDULE.deprecatedAt),
      Date.parse("2027-04-17T10:30:00.000Z"),
      sunsetMs,
      sunsetMs + 5 * 365 * DAY,
    ]) {
      expect(retired(now, false, SCHEDULE), String(now)).toBe(false);
    }
  });

  it("is false before the Sunset when enforcing, outside the brownouts", () => {
    expect(retired(Date.parse(SCHEDULE.deprecatedAt), true, SCHEDULE)).toBe(
      false,
    );
    expect(
      retired(Date.parse("2027-04-17T09:59:59.999Z"), true, SCHEDULE),
    ).toBe(false);
    expect(retired(sunsetMs - 1, true, SCHEDULE)).toBe(false);
  });

  it("is retired from the Sunset instant on, with no wait to report", () => {
    expect(retired(sunsetMs, true, SCHEDULE)).toEqual({ brownout: false });
    expect(retired(sunsetMs + 400 * DAY, true, SCHEDULE)).toEqual({
      brownout: false,
    });
  });

  it("answers a brownout with the seconds left in the window", () => {
    const from = Date.parse(SCHEDULE.brownouts[0].from);
    expect(retired(from, true, SCHEDULE)).toEqual({
      brownout: true,
      retryAfter: 3600,
    });
    expect(retired(from + 30 * 60 * 1000, true, SCHEDULE)).toEqual({
      brownout: true,
      retryAfter: 1800,
    });
    expect(retired(from + HOUR - 1, true, SCHEDULE)).toEqual({
      brownout: true,
      retryAfter: 1,
    });
  });

  it("includes the start of a window and excludes its end", () => {
    const to = Date.parse(SCHEDULE.brownouts[0].to);
    expect(retired(to, true, SCHEDULE)).toBe(false);
    expect(retired(to + 1, true, SCHEDULE)).toBe(false);
  });

  it("finds a later window too", () => {
    expect(
      retired(Date.parse("2027-04-24T10:15:00.000Z"), true, SCHEDULE),
    ).toEqual({
      brownout: true,
      retryAfter: 2700,
    });
  });

  it("reports the retirement, not a brownout, once past the Sunset", () => {
    const late: DeprecationSchedule = {
      ...SCHEDULE,
      brownouts: [{ from: SUNSET, to: "2027-05-01T01:00:00.000Z" }],
    };
    expect(retired(sunsetMs + 1, true, late)).toEqual({ brownout: false });
  });

  it("stays dormant on an empty or unreadable schedule, even when enforcing", () => {
    const empty: DeprecationSchedule = {
      deprecatedAt: "",
      sunset: "",
      brownouts: [],
    };
    expect(retired(Date.now(), true, empty)).toBe(false);
    expect(
      retired(Date.now(), true, {
        deprecatedAt: "x",
        sunset: "tomorrow-ish",
        brownouts: [{ from: "x", to: "y" }],
      }),
    ).toBe(false);
  });

  it("is dormant with the schedule the repository ships", () => {
    expect(retired(Date.now(), true)).toBe(false);
    expect(retired(Date.parse("2099-01-01"), true)).toBe(false);
    expect(deprecationHeaders({})).toBeNull();
  });
});

describe("deprecationHeaders", () => {
  it("is null while the deprecation date is empty or unreadable", () => {
    expect(
      deprecationHeaders({ schedule: { ...SCHEDULE, deprecatedAt: "" } }),
    ).toBeNull();
    expect(
      deprecationHeaders({ schedule: { ...SCHEDULE, deprecatedAt: "soon" } }),
    ).toBeNull();
  });

  it("sends Deprecation as a unix timestamp, Sunset as an HTTP date, and both Links", () => {
    const headers = deprecationHeaders({
      schedule: SCHEDULE,
      successorPath: "/api/v4/history/abc123/report",
    });
    expect(headers).not.toBeNull();
    expect(headers?.get("deprecation")).toBe(
      `@${Date.parse(SCHEDULE.deprecatedAt) / 1000}`,
    );
    expect(headers?.get("sunset")).toBe("Sat, 01 May 2027 00:00:00 GMT");
    const links = headers?.get("link") ?? "";
    expect(links).toContain(
      `<${MIGRATION_GUIDE_PATH}>; rel="deprecation"; type="text/html"`,
    );
    expect(links).toContain(
      '</api/v4/history/abc123/report>; rel="successor-version"',
    );
  });

  it("leaves out the successor link for an alias that has no v4 target", () => {
    const links = deprecationHeaders({ schedule: SCHEDULE })?.get("link") ?? "";
    expect(links).toContain('rel="deprecation"');
    expect(links).not.toContain("successor-version");
  });

  it("leaves out Sunset when the date cannot be read", () => {
    const headers = deprecationHeaders({
      schedule: { ...SCHEDULE, sunset: "" },
    });
    expect(headers?.get("deprecation")).toMatch(/^@\d+$/);
    expect(headers?.get("sunset")).toBeNull();
  });

  it("produces only relative references, never an origin", () => {
    const headers = deprecationHeaders({
      schedule: SCHEDULE,
      successorPath: "/api/v4/scan/status/42",
    });
    const links = headers?.get("link") ?? "";
    for (const match of links.matchAll(/<([^>]*)>/g)) {
      expect(match[1]).toMatch(/^\/[^/]/);
    }
    expect(links).not.toMatch(/https?:|localhost|\/\//);
  });
});

describe("successorLink", () => {
  it("keeps a plain path as it is, percent escapes included", () => {
    expect(successorLink("/api/v4/host/ex%20ample.com")).toBe(
      '</api/v4/host/ex%20ample.com>; rel="successor-version"',
    );
  });

  it("encodes anything that could end the target or the header", () => {
    for (const hostile of [
      "/api/v4/x>; rel=evil",
      "/api/v4/x\r\nSet-Cookie: a=b",
      "/api/v4/x\nInjected: 1",
      "/api/v4/x y",
      '/api/v4/x"y',
      "/api/v4/\u00e9\u4e2d",
      "/api/v4/x\ud800y",
    ]) {
      const link = successorLink(hostile);
      expect(link, hostile).toMatch(
        /^<[A-Za-z0-9\-._~!$&'()*+,;=:@/%]+>; rel="successor-version"$/,
      );
      expect(link).not.toMatch(/[\r\n]/);
      expect(link.match(/>/g)).toHaveLength(1);
    }
  });

  it("never lets a protocol-relative target through", () => {
    expect(successorLink("//evil.example/api/v4/x")).toBe(
      '</evil.example/api/v4/x>; rel="successor-version"',
    );
    expect(successorLink("api/v4/x")).toBe(
      '</api/v4/x>; rel="successor-version"',
    );
  });
});

describe("retirementMessage", () => {
  it("names the retirement date and tells the reader to update before it says to move", () => {
    const text = retirementMessage(SUNSET);
    expect(text.startsWith("API v3 was retired on 2027-05-01.")).toBe(true);
    const update = text.indexOf("update it to the latest release");
    const move = text.indexOf("move to /api/v4");
    expect(update).toBeGreaterThan(-1);
    expect(move).toBeGreaterThan(update);
    expect(text).toContain(
      "VulnRadar CLI, GitHub Action, GitLab template or browser extension",
    );
    expect(text).toContain(`(guide: ${MIGRATION_GUIDE_PATH} on this server)`);
  });

  it("says a brownout is not the real date", () => {
    const text = retirementMessage(SUNSET, true);
    expect(text).toContain("scheduled brownout");
    expect(text).toContain("will be retired on 2027-05-01");
    expect(text).not.toContain("was retired");
    expect(text.indexOf("update it")).toBeLessThan(
      text.indexOf("move to /api/v4"),
    );
  });

  it("carries no absolute URL and none of the characters the copy rules ban", () => {
    for (const text of [
      retirementMessage(SUNSET),
      retirementMessage(SUNSET, true),
    ]) {
      expect(text).not.toMatch(/https?:|localhost/);
      expect(text).not.toMatch(/[\u2013\u2014\u00b7]/);
    }
  });

  it("does not throw on an unreadable date", () => {
    expect(retirementMessage("")).toContain("API v3 was retired on");
  });
});

describe("retirementDetails", () => {
  it("lists the sunset, the successor and the guide as paths", () => {
    expect(
      retirementDetails({
        sunset: SUNSET,
        successorPath: "/api/v4/scan",
        brownout: true,
      }),
    ).toEqual({
      sunset: SUNSET,
      successor: "/api/v4/scan",
      migrationGuide: "/docs/api/migrate-v4",
      brownout: true,
    });
  });

  it("points the successor at the v4 root when the alias has no direct target", () => {
    expect(
      retirementDetails({ sunset: SUNSET, brownout: false }).successor,
    ).toBe("/api/v4");
  });
});

describe("the 410 answer built from the pieces", () => {
  it("is a no-store error envelope with the successor link and, in a brownout, a wait", async () => {
    const brownout = retired(
      Date.parse("2027-04-17T10:15:00.000Z"),
      true,
      SCHEDULE,
    );
    expect(brownout).toMatchObject({ brownout: true });
    if (!brownout) throw new Error("expected a brownout");

    const response = buildError({
      version: "v3",
      status: 410,
      code: "API_VERSION_SUNSET",
      message: retirementMessage(SCHEDULE.sunset, brownout.brownout),
      requestId: "req-410",
      details: retirementDetails({
        sunset: SCHEDULE.sunset,
        successorPath: "/api/v4/history/abc",
        brownout: brownout.brownout,
      }),
      retryAfter: brownout.retryAfter,
      headers: { Link: successorLink("/api/v4/history/abc") },
    });

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("2700");
    expect(response.headers.get("link")).toContain("successor-version");
    const body = await response.json();
    expect(body.code).toBe("API_VERSION_SUNSET");
    expect(body.requestId).toBe("req-410");
    expect(body.details.brownout).toBe(true);
    expect(body.details.successor).toBe("/api/v4/history/abc");
    expect(body).not.toHaveProperty("paused");
  });

  it("carries no wait once the instance is fully retired", () => {
    const response = buildError({
      version: "v3",
      status: 410,
      code: "API_VERSION_SUNSET",
      message: retirementMessage(SCHEDULE.sunset),
      requestId: "r",
    });
    expect(response.headers.get("retry-after")).toBeNull();
  });
});

describe("currentSchedule", () => {
  it("reads the three dormant constants", () => {
    expect(currentSchedule()).toEqual({
      deprecatedAt: "",
      sunset: "",
      brownouts: [],
    });
  });
});
