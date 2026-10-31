import { DEFAULT_LOCALE } from "./config";

/**
 * Dates, relative times, numbers and plural categories for one language.
 *
 * lib/ui/format-date.ts, relative-time.ts and plural.ts are en-US on purpose:
 * the product's copy was English, and a date that changed shape with the
 * viewer's browser was the drift they replaced. A surface that has moved onto
 * t() cannot keep them, since "5m ago" under a Japanese heading is the same
 * bug the other way round. These are their counterparts for a translated
 * surface: the same styles, but the language comes from the reader.
 *
 * Plain Intl, no React and no next-intl, so one implementation serves the
 * client hook (hooks.ts), the async server components (server.ts) and the
 * email sender, which has no request to read a locale from.
 *
 * Every method returns null for a value it cannot format, where the English
 * helpers returned "Unknown date". The wording of that fallback is a
 * translation (`t("unknownDate")`), so the caller supplies it:
 * `fmt.date(scan.createdAt) ?? t("unknownDate")`.
 */

export type DateInput = string | number | Date | null | undefined;

/**
 * Typed loose on purpose, for the reason plural.ts is: node-postgres hands a
 * COUNT(*) back as a string, and "1,234" is wanted for it all the same.
 */
export type NumberInput = number | string | null | undefined;

export interface FormatterOptions {
  /**
   * IANA zone to print dates in. Left out, the runtime's own: the reader's
   * browser on the client, the server's (UTC) on the server. A client
   * component is rendered once on the server as well, so it prints in the
   * server's zone first and the reader's at hydration, and the two disagree
   * about the clock time (and for some hours of the day, the date). Format
   * where the value only exists after mount, or pass the same zone to both.
   */
  timeZone?: string;
}

export interface Formatters {
  /** The language these were built for, after validation. */
  readonly locale: string;
  /** "Sep 16, 2026". */
  date(value: DateInput): string | null;
  /** "Sep 16, 2026, 08:07 AM"; the clock follows the language (24-hour in Japanese). */
  dateTime(value: DateInput, options?: { seconds?: boolean }): string | null;
  /** "Sep 16", for a dense row where the year is implied. */
  monthDay(value: DateInput): string | null;
  /** "08:07 AM". */
  time(value: DateInput): string | null;
  /**
   * "now", "5 min. ago", "in 3 hr.", "2 days ago", then a date past a week
   * (with the year once it is not this year's). The counterpart of
   * formatRelativeTime. `now` is a parameter so a render stays pure: take it
   * from `useNow()` (lib/ui/clock.ts), not from Date.now() in the component.
   */
  relativeTime(value: DateInput, now?: DateInput): string | null;
  /** "1,234" or "1.234", from a number or a numeric string. */
  number(value: NumberInput, options?: Intl.NumberFormatOptions): string | null;
  /** "1.2K". */
  compactNumber(value: NumberInput): string | null;
  /** A fraction as a percentage: 0.375 -> "38%". */
  percent(fraction: NumberInput, fractionDigits?: number): string | null;
  /**
   * The plural form this language uses for a count ("one", "other", and for
   * Russian or Arabic, more). Messages should carry the rule themselves
   * (`{count, plural, ...}`); this is for the rare caller that has to choose
   * between two separate keys.
   */
  pluralCategory(count: NumberInput): Intl.LDMLPluralRule;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function toTime(value: DateInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function toNumber(value: NumberInput): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A tag Intl will accept, or English: a bad cookie must not throw mid-render. */
function usableLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(
  locale: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone ?? ""}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    } catch {
      // An unknown zone name: print in the runtime's own rather than throw.
      format = new Intl.DateTimeFormat(locale, options);
    }
    dateFormats.set(key, format);
  }
  return format;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(
  locale: string,
  options: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options ?? {})}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  let format = relativeFormats.get(locale);
  if (!format) {
    // numeric "auto" is what turns 0 seconds into "now" and -1 day into
    // "yesterday", in whichever words the language has for them.
    format = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
      style: "short",
    });
    relativeFormats.set(locale, format);
  }
  return format;
}

const pluralRules = new Map<string, Intl.PluralRules>();

function pluralRulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

const instances = new Map<string, Formatters>();

/**
 * The formatters for a language. The same object comes back for the same
 * language and zone, so a hook can hand it to a dependency array.
 */
export function createFormatters(
  locale: string,
  options: FormatterOptions = {},
): Formatters {
  const tag = usableLocale(locale);
  const { timeZone } = options;
  const instanceKey = `${tag}|${timeZone ?? ""}`;
  const existing = instances.get(instanceKey);
  if (existing) return existing;

  const at = (style: Intl.DateTimeFormatOptions) =>
    dateFormat(tag, timeZone, style);

  const formatters: Formatters = {
    locale: tag,

    date(value) {
      const time = toTime(value);
      return time === null
        ? null
        : at({ month: "short", day: "numeric", year: "numeric" }).format(time);
    },

    dateTime(value, { seconds = false } = {}) {
      const time = toTime(value);
      return time === null
        ? null
        : at({
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            ...(seconds ? { second: "2-digit" as const } : {}),
          }).format(time);
    },

    monthDay(value) {
      const time = toTime(value);
      return time === null
        ? null
        : at({ month: "short", day: "numeric" }).format(time);
    },

    time(value) {
      const time = toTime(value);
      return time === null
        ? null
        : at({ hour: "2-digit", minute: "2-digit" }).format(time);
    },

    relativeTime(value, now = Date.now()) {
      const then = toTime(value);
      const reference = toTime(now);
      if (then === null || reference === null) return null;

      const diff = then - reference;
      const distance = Math.abs(diff);
      const relative = relativeFormat(tag);
      if (distance < MINUTE) return relative.format(0, "second");
      if (distance < HOUR) {
        return relative.format(Math.trunc(diff / MINUTE), "minute");
      }
      if (distance < DAY) {
        return relative.format(Math.trunc(diff / HOUR), "hour");
      }
      if (distance < WEEK) {
        return relative.format(Math.trunc(diff / DAY), "day");
      }

      const year = at({ year: "numeric" });
      const thisYear = year.format(then) === year.format(reference);
      return at({
        month: "short",
        day: "numeric",
        ...(thisYear ? {} : { year: "numeric" as const }),
      }).format(then);
    },

    number(value, formatOptions) {
      const n = toNumber(value);
      return n === null ? null : numberFormat(tag, formatOptions).format(n);
    },

    compactNumber(value) {
      const n = toNumber(value);
      return n === null
        ? null
        : numberFormat(tag, {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(n);
    },

    percent(fraction, fractionDigits = 0) {
      const n = toNumber(fraction);
      return n === null
        ? null
        : numberFormat(tag, {
            style: "percent",
            maximumFractionDigits: fractionDigits,
          }).format(n);
    },

    pluralCategory(count) {
      return pluralRulesFor(tag).select(toNumber(count) ?? 0);
    },
  };

  instances.set(instanceKey, formatters);
  return formatters;
}
