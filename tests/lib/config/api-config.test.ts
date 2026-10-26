import { describe, expect, it } from "vitest";

import { addCalendarMonths } from "@/lib/api/deprecation";
import { PREFIX } from "@/lib/api/route-registry";
import * as configValues from "@/lib/config/config-values";
import {
  CONFIG_API_CURRENT_VERSION,
  CONFIG_API_INTERNAL_PREFIX,
  CONFIG_API_SUPPORTED_VERSIONS,
  CONFIG_API_V3_BROWNOUTS,
  CONFIG_API_V3_DEPRECATED_AT,
  CONFIG_API_V3_SUNSET,
  CONFIG_API_VERSION,
} from "@/lib/config/config-values";
import { NEVER_CONFIGURABLE, SETTINGS_REGISTRY } from "@/lib/config/registry";

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 45;

interface Calendar {
  deprecatedAt: string;
  sunset: string;
  brownouts: readonly { from: string; to: string }[];
}

/**
 * Problems with a retirement calendar, empty when it is sound. Calendar
 * arithmetic, not a day count: six calendar months are 181 to 184 days, and a
 * start between September and February gives 181 or 182, so any ">= 183 days"
 * rule fails for the likeliest release window.
 */
function calendarProblems(calendar: Calendar): string[] {
  if (calendar.deprecatedAt === "") {
    return calendar.sunset === "" && calendar.brownouts.length === 0
      ? []
      : ["sunset and brownouts are set but deprecatedAt is empty"];
  }
  const problems: string[] = [];
  const sunset = Date.parse(calendar.sunset);
  if (Number.isNaN(sunset)) return ["sunset is not a date"];
  const earliest = addCalendarMonths(calendar.deprecatedAt, 6).getTime();
  if (sunset < earliest) {
    problems.push(`sunset is before deprecatedAt plus six calendar months`);
  }
  for (const window of calendar.brownouts) {
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
      problems.push(`brownout ${window.from} to ${window.to} is not a window`);
    } else if (from < sunset - WINDOW_DAYS * DAY || to > sunset) {
      problems.push(
        `brownout ${window.from} to ${window.to} is not in the last ${WINDOW_DAYS} days before the sunset`,
      );
    }
  }
  return problems;
}

describe("the retirement calendar the repository ships", () => {
  it("is sound, whether it is still dormant or the release commit has filled it in", () => {
    expect(
      calendarProblems({
        deprecatedAt: CONFIG_API_V3_DEPRECATED_AT,
        sunset: CONFIG_API_V3_SUNSET,
        brownouts: CONFIG_API_V3_BROWNOUTS,
      }),
    ).toEqual([]);
  });

  it("is dormant until the release commit", () => {
    expect(CONFIG_API_V3_DEPRECATED_AT).toBe("");
    expect(CONFIG_API_V3_SUNSET).toBe("");
    expect(CONFIG_API_V3_BROWNOUTS).toEqual([]);
  });
});

describe("the calendar rule itself", () => {
  const deprecatedAt = "2026-11-01T00:00:00.000Z";

  it("accepts a Sunset of exactly six calendar months, which is 181 days here", () => {
    expect(
      calendarProblems({
        deprecatedAt,
        sunset: "2027-05-01T00:00:00.000Z",
        brownouts: [],
      }),
    ).toEqual([]);
  });

  it("accepts a later Sunset and rejects an earlier one", () => {
    expect(
      calendarProblems({
        deprecatedAt,
        sunset: "2027-06-01T00:00:00.000Z",
        brownouts: [],
      }),
    ).toEqual([]);
    expect(
      calendarProblems({
        deprecatedAt,
        sunset: "2027-04-30T23:59:59.999Z",
        brownouts: [],
      }),
    ).toHaveLength(1);
  });

  it("rejects a Sunset that is not a date", () => {
    expect(
      calendarProblems({ deprecatedAt, sunset: "", brownouts: [] }),
    ).toEqual(["sunset is not a date"]);
  });

  it("requires every brownout to be a window inside the last 45 days before the Sunset", () => {
    const sunset = "2027-05-01T00:00:00.000Z";
    const ok = {
      from: "2027-04-17T10:00:00.000Z",
      to: "2027-04-17T11:00:00.000Z",
    };
    expect(calendarProblems({ deprecatedAt, sunset, brownouts: [ok] })).toEqual(
      [],
    );

    const tooEarly = {
      from: "2027-03-01T10:00:00.000Z",
      to: "2027-03-01T11:00:00.000Z",
    };
    const afterSunset = {
      from: "2027-05-01T10:00:00.000Z",
      to: "2027-05-01T11:00:00.000Z",
    };
    const backwards = { from: ok.to, to: ok.from };
    for (const bad of [tooEarly, afterSunset, backwards]) {
      expect(
        calendarProblems({ deprecatedAt, sunset, brownouts: [bad] }),
      ).toHaveLength(1);
    }
  });

  it("rejects dates set without a deprecation date", () => {
    expect(
      calendarProblems({
        deprecatedAt: "",
        sunset: "2027-05-01T00:00:00.000Z",
        brownouts: [],
      }),
    ).toHaveLength(1);
  });
});

describe("version constants", () => {
  it("advertises v3 and serves only v3 until the v4 contract is complete", () => {
    expect(CONFIG_API_VERSION).toBe("v3");
    expect(CONFIG_API_CURRENT_VERSION).toBe(CONFIG_API_VERSION);
    expect([...CONFIG_API_SUPPORTED_VERSIONS]).toEqual(["v3"]);
  });

  it("only advertises a version that it serves", () => {
    expect(CONFIG_API_SUPPORTED_VERSIONS).toContain(CONFIG_API_VERSION);
  });

  it("spells the internal prefix the way the route registry does", () => {
    expect(CONFIG_API_INTERNAL_PREFIX).toBe("/api/internal");
    expect(PREFIX.INTERNAL).toBe(CONFIG_API_INTERNAL_PREFIX);
  });
});

describe("locked entries", () => {
  const keys = [
    "API_VERSION",
    "API_CURRENT_VERSION",
    "API_SUPPORTED_VERSIONS",
    "API_INTERNAL_PREFIX",
    "API_V3_DEPRECATED_AT",
    "API_V3_SUNSET",
    "API_V3_BROWNOUTS",
  ] as const;

  it.each(keys)(
    "locks %s, with a constant behind it and a reason in plain words",
    (key) => {
      expect(key in SETTINGS_REGISTRY).toBe(false);
      const reason = NEVER_CONFIGURABLE[key];
      expect(reason.length).toBeGreaterThan(40);
      expect(reason).not.toMatch(/[\u2013\u2014\u00b7]/);
      expect(
        (configValues as Record<string, unknown>)[`CONFIG_${key}`],
      ).not.toBeUndefined();
    },
  );

  it("keeps API path literals out of the reasons, which the literal ratchet would flag", () => {
    for (const key of keys) {
      expect(NEVER_CONFIGURABLE[key], key).not.toMatch(
        /\/api\/(?:v\d|internal)/,
      );
    }
  });
});
