// What API v3 says about its own retirement: the headers on every deprecated
// answer, the calendar arithmetic that fixes the Sunset date, and the rule
// that decides when an instance that opted in starts answering 410.
//
// Edge-safe. Middleware calls it, and the only things it reads are the three
// dormant CONFIG_API_V3_* constants and the route registry's prefixes.
//
// Every URL this module produces is a relative reference. Inside `next start`
// the middleware's request.url holds the bind address (http://localhost:3000
// in the image), not the public host, and the Host header is the client's to
// choose, so no origin built here could be right and some would be hostile.
// RFC 8288 resolves a relative Link target against the request URI, which is
// the one origin that is always correct.

import {
  CONFIG_API_V3_BROWNOUTS,
  CONFIG_API_V3_DEPRECATED_AT,
  CONFIG_API_V3_SUNSET,
} from "../config/config-values";
import { PREFIX } from "./route-registry";

export interface Brownout {
  from: string;
  to: string;
}

export interface DeprecationSchedule {
  deprecatedAt: string;
  sunset: string;
  brownouts: readonly Brownout[];
}

export const MIGRATION_GUIDE_PATH = "/docs/api/migrate-v4";

export function currentSchedule(): DeprecationSchedule {
  return {
    deprecatedAt: CONFIG_API_V3_DEPRECATED_AT,
    sunset: CONFIG_API_V3_SUNSET,
    brownouts: CONFIG_API_V3_BROWNOUTS,
  };
}

/**
 * `months` calendar months after `from`, in UTC, keeping the time of day. When
 * the target month is shorter the result clamps to its last day (31 August
 * plus six months is 28 or 29 February), never rolling into the next month.
 *
 * Six calendar months are 181 to 184 days, so the Sunset must be computed with
 * this and not with a day count: 2026-11-01 plus six months is 2027-05-01,
 * which is 181 days.
 */
export function addCalendarMonths(
  from: string | number | Date,
  months: number,
): Date {
  if (!Number.isInteger(months)) {
    throw new RangeError(`Months must be an integer: ${months}`);
  }
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) {
    throw new RangeError(`Not a date: ${String(from)}`);
  }
  const absolute = start.getUTCFullYear() * 12 + start.getUTCMonth() + months;
  const year = Math.floor(absolute / 12);
  const month = absolute - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(start.getTime());
  result.setUTCFullYear(year, month, Math.min(start.getUTCDate(), lastDay));
  return result;
}

export interface Retired {
  brownout: boolean;
  /** Seconds until the brownout window closes. Absent once fully retired. */
  retryAfter?: number;
}

/**
 * Whether an instance that set API_V3_SUNSET_ENFORCE should answer 410 now.
 * `enforce` is the environment switch, passed in because the edge cannot read
 * the settings table; with it off nothing here ever returns anything but
 * false, at any date.
 */
export function retired(
  now: number,
  enforce: boolean,
  schedule: DeprecationSchedule = currentSchedule(),
): false | Retired {
  if (!enforce) return false;
  if (now >= Date.parse(schedule.sunset)) return { brownout: false };
  for (const window of schedule.brownouts) {
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (now >= from && now < to) {
      return { brownout: true, retryAfter: Math.ceil((to - now) / 1000) };
    }
  }
  return false;
}

const SAFE_REFERENCE = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/%]/gu;

function encodeCharacter(char: string): string {
  try {
    return encodeURIComponent(char);
  } catch {
    // A lone surrogate has no UTF-8 form; the replacement character does.
    return "%EF%BF%BD";
  }
}

/**
 * A request-derived path as a Link target. The path comes from the client, so
 * anything that is not a URI character is percent-encoded rather than trusted,
 * which keeps a `>` or a line break out of the header.
 */
function relativeReference(path: string): string {
  const encoded = path.replace(SAFE_REFERENCE, encodeCharacter);
  return encoded.startsWith("/") && !encoded.startsWith("//")
    ? encoded
    : `/${encoded.replace(/^\/+/, "")}`;
}

export function successorLink(successorPath: string): string {
  return `<${relativeReference(successorPath)}>; rel="successor-version"`;
}

/**
 * Deprecation, Sunset and Link headers for an answer that came through a v3
 * alias. Null while CONFIG_API_V3_DEPRECATED_AT is empty, which keeps the whole
 * mechanism dormant until the release commit sets the dates.
 *
 * `successorPath` is the canonical v4 path with the received path parameters
 * kept, and only for aliases that have a v4 target; aliases to internal routes
 * have no successor to point at.
 */
export function deprecationHeaders(options: {
  successorPath?: string;
  schedule?: DeprecationSchedule;
}): Headers | null {
  const schedule = options.schedule ?? currentSchedule();
  const deprecatedAt = Date.parse(schedule.deprecatedAt);
  if (Number.isNaN(deprecatedAt)) return null;

  const headers = new Headers();
  headers.set("Deprecation", `@${Math.floor(deprecatedAt / 1000)}`);
  const sunset = Date.parse(schedule.sunset);
  if (!Number.isNaN(sunset)) {
    headers.set("Sunset", new Date(sunset).toUTCString());
  }
  headers.append(
    "Link",
    `<${MIGRATION_GUIDE_PATH}>; rel="deprecation"; type="text/html"`,
  );
  if (options.successorPath !== undefined) {
    headers.append("Link", successorLink(options.successorPath));
  }
  return headers;
}

function sunsetDay(sunset: string): string {
  const time = Date.parse(sunset);
  return Number.isNaN(time)
    ? sunset
    : new Date(time).toISOString().slice(0, 10);
}

/**
 * The 410 body text. An old client prints `body.error` verbatim, so one
 * sentence has to serve two readers: someone running the CLI, Action, GitLab
 * template or extension, and someone calling the API directly. "Update" comes
 * first on purpose. A pinned Action that is merely pointed at the new prefix
 * fails with a missing scan id, which turns a clear 410 into a confusing
 * failure. The request cannot say which reader it is: every pre-4.0 client
 * lacks the header that would tell.
 */
export function retirementMessage(sunset: string, brownout = false): string {
  const when = brownout
    ? `API v3 is switched off for a scheduled brownout and will be retired on ${sunsetDay(sunset)}.`
    : `API v3 was retired on ${sunsetDay(sunset)}.`;
  return `${when} If you use the VulnRadar CLI, GitHub Action, GitLab template or browser extension, update it to the latest release. If you call the API yourself, move to ${PREFIX.V4} (guide: ${MIGRATION_GUIDE_PATH} on this server).`;
}

export function retirementDetails(options: {
  sunset: string;
  successorPath?: string;
  brownout: boolean;
}): Record<string, unknown> {
  const time = Date.parse(options.sunset);
  return {
    sunset: Number.isNaN(time) ? options.sunset : new Date(time).toISOString(),
    successor: options.successorPath ?? PREFIX.V4,
    migrationGuide: MIGRATION_GUIDE_PATH,
    brownout: options.brownout,
  };
}
