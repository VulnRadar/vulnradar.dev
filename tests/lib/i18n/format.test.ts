/**
 * Dates, relative times, numbers and plural categories in the reader's
 * language (lib/i18n/format.ts).
 *
 * The English results are asserted exactly, because they are meant to be the
 * output of lib/ui/format-date.ts for a reader whose language is English. The
 * other languages are asserted as what they must be (Japanese in full, the
 * rest as "not the English string"), since ICU's exact abbreviations differ
 * between Node and browser releases and a test pinned to one of them would
 * fail on the next.
 */
import { describe, it, expect } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { createFormatters } from "@/lib/i18n/format";
import {
  formatDate,
  formatDateTime,
  formatMonthDay,
} from "@/lib/ui/format-date";

const WHEN = new Date("2026-09-16T08:07:09Z");
const NOW = new Date("2026-09-16T12:00:00Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** ICU puts a narrow no-break space before AM and PM in newer releases. */
const plain = (value: string | null) => value?.replace(/[  ]/g, " ");

const en = createFormatters("en", { timeZone: "UTC" });
const ja = createFormatters("ja", { timeZone: "UTC" });

describe("dates", () => {
  it("print the same styles as the English helpers for an English reader", () => {
    // No zone given on either side, so both print in the runtime's own.
    const fmt = createFormatters("en");
    const iso = WHEN.toISOString();
    expect(fmt.date(iso)).toBe(formatDate(iso));
    expect(fmt.dateTime(iso)).toBe(formatDateTime(iso));
    expect(fmt.dateTime(iso, { seconds: true })).toBe(
      formatDateTime(iso, true),
    );
    expect(fmt.monthDay(iso)).toBe(formatMonthDay(iso));
  });

  it("read in English", () => {
    expect(en.date(WHEN)).toBe("Sep 16, 2026");
    expect(plain(en.dateTime(WHEN))).toBe("Sep 16, 2026, 08:07 AM");
    expect(plain(en.dateTime(WHEN, { seconds: true }))).toBe(
      "Sep 16, 2026, 08:07:09 AM",
    );
    expect(en.monthDay(WHEN)).toBe("Sep 16");
    expect(plain(en.time(WHEN))).toBe("08:07 AM");
  });

  it("read in Japanese, with its own order and a 24-hour clock", () => {
    expect(ja.date(WHEN)).toBe("2026年9月16日");
    expect(plain(ja.dateTime(WHEN))).toBe("2026年9月16日 08:07");
    expect(ja.monthDay(WHEN)).toBe("9月16日");
    expect(ja.time(WHEN)).toBe("08:07");
  });

  it.each(LOCALES.filter((l) => l !== "en"))(
    "do not come out in the English shape for %s",
    (locale) => {
      const fmt = createFormatters(locale, { timeZone: "UTC" });
      expect(fmt.date(WHEN)).toContain("2026");
      expect(fmt.date(WHEN)).not.toBe(en.date(WHEN));
    },
  );

  it("take a string, a number or a Date", () => {
    expect(en.date("2026-09-16T08:07:09Z")).toBe("Sep 16, 2026");
    expect(en.date(WHEN.getTime())).toBe("Sep 16, 2026");
  });

  it("follow the zone they are given", () => {
    const tokyo = createFormatters("en", { timeZone: "Asia/Tokyo" });
    // 08:07 UTC on the 16th is 17:07 in Tokyo, still the 16th; 20:00 UTC is
    // already the 17th there.
    expect(tokyo.date("2026-09-16T08:07:00Z")).toBe("Sep 16, 2026");
    expect(tokyo.date("2026-09-16T20:00:00Z")).toBe("Sep 17, 2026");
  });

  it("do not throw for a zone that does not exist", () => {
    const odd = createFormatters("en", { timeZone: "Mars/Olympus" });
    expect(odd.date(WHEN)).toContain("2026");
  });

  it.each([null, undefined, "", "not a date", Number.NaN])(
    "give null for %j rather than printing the epoch or Invalid Date",
    (value) => {
      expect(en.date(value as string)).toBeNull();
      expect(en.dateTime(value as string)).toBeNull();
      expect(en.monthDay(value as string)).toBeNull();
      expect(en.time(value as string)).toBeNull();
      expect(en.relativeTime(value as string, NOW)).toBeNull();
    },
  );
});

describe("relativeTime", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it("reads a few seconds as now", () => {
    expect(en.relativeTime(ago(30_000), NOW)).toBe("now");
    expect(ja.relativeTime(ago(30_000), NOW)).toBe("今");
  });

  it("counts minutes, hours and days back", () => {
    expect(en.relativeTime(ago(5 * MINUTE), NOW)).toBe("5 min. ago");
    expect(en.relativeTime(ago(3 * HOUR), NOW)).toBe("3 hr. ago");
    expect(en.relativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(plain(ja.relativeTime(ago(5 * MINUTE), NOW))).toBe("5 分前");
  });

  it("uses the language's own word for yesterday", () => {
    expect(en.relativeTime(ago(DAY), NOW)).toBe("yesterday");
    expect(ja.relativeTime(ago(DAY), NOW)).toBe("昨日");
  });

  it("counts forward as well", () => {
    expect(en.relativeTime(new Date(NOW.getTime() + 3 * HOUR), NOW)).toBe(
      "in 3 hr.",
    );
  });

  it("rounds toward the present, the way a clock does", () => {
    // 59 minutes 59 seconds is still 59 minutes, not an hour.
    expect(en.relativeTime(ago(HOUR - 1000), NOW)).toBe("59 min. ago");
  });

  it("falls back to a date past a week, with the year once it is not this year's", () => {
    expect(en.relativeTime(ago(6 * DAY), NOW)).toBe("6 days ago");
    expect(en.relativeTime(ago(8 * DAY), NOW)).toBe("Sep 8");
    expect(en.relativeTime("2025-12-30T10:00:00Z", NOW)).toBe("Dec 30, 2025");
    expect(ja.relativeTime(ago(8 * DAY), NOW)).toBe("9月8日");
  });

  it("takes the current time from the caller, or from the clock", () => {
    const justNow = en.relativeTime(new Date(), undefined);
    expect(justNow).toBe("now");
    expect(en.relativeTime(WHEN, WHEN.getTime() + 2 * HOUR)).toBe("2 hr. ago");
  });
});

describe("numbers", () => {
  it("group digits the way the language does", () => {
    expect(en.number(1234567.891)).toBe("1,234,567.891");
    expect(createFormatters("de").number(1234567.891)).toBe("1.234.567,891");
    expect(createFormatters("ja").number(1234567.891)).toBe("1,234,567.891");
  });

  it("take a numeric string, which is what node-postgres returns for COUNT(*)", () => {
    expect(en.number("1234")).toBe("1,234");
  });

  it("pass Intl options through", () => {
    expect(en.number(3.14159, { maximumFractionDigits: 2 })).toBe("3.14");
    expect(en.number(5, { style: "currency", currency: "USD" })).toBe("$5.00");
  });

  it("abbreviate large counts", () => {
    expect(en.compactNumber(1234)).toBe("1.2K");
    expect(en.compactNumber("2500000")).toBe("2.5M");
  });

  it("print a fraction as a percentage", () => {
    expect(en.percent(0.375)).toBe("38%");
    expect(en.percent(0.375, 1)).toBe("37.5%");
    expect(createFormatters("de").percent(0.5)).toMatch(/^50\s%$/);
  });

  it.each([null, undefined, "", "abc", Number.NaN, Infinity])(
    "give null for %j",
    (value) => {
      expect(en.number(value as number)).toBeNull();
      expect(en.compactNumber(value as number)).toBeNull();
      expect(en.percent(value as number)).toBeNull();
    },
  );
});

describe("pluralCategory", () => {
  it("separates one from many in English", () => {
    expect(en.pluralCategory(1)).toBe("one");
    expect(en.pluralCategory(0)).toBe("other");
    expect(en.pluralCategory(5)).toBe("other");
  });

  it("takes a numeric string", () => {
    expect(en.pluralCategory("1")).toBe("one");
  });

  it("follows the language: French counts 0 as singular, Japanese has no plural", () => {
    expect(createFormatters("fr").pluralCategory(0)).toBe("one");
    expect(createFormatters("ja").pluralCategory(1)).toBe("other");
  });
});

describe("createFormatters", () => {
  it("returns the same object for the same language and zone", () => {
    expect(createFormatters("en")).toBe(createFormatters("en"));
    expect(createFormatters("en", { timeZone: "UTC" })).toBe(
      createFormatters("en", { timeZone: "UTC" }),
    );
    expect(createFormatters("en", { timeZone: "UTC" })).not.toBe(
      createFormatters("en"),
    );
  });

  it("falls back to English for a tag Intl rejects, instead of throwing", () => {
    const odd = createFormatters("not a locale!!");
    expect(odd.locale).toBe("en");
    expect(odd.number(1234)).toBe("1,234");
  });

  it.each(LOCALES)("builds for every language the app speaks: %s", (locale) => {
    const fmt = createFormatters(locale, { timeZone: "UTC" });
    expect(fmt.locale).toBe(locale);
    expect(fmt.date(WHEN)).not.toBeNull();
    expect(fmt.relativeTime(WHEN, NOW)).not.toBeNull();
    expect(fmt.number(1234.5)).not.toBeNull();
  });
});
