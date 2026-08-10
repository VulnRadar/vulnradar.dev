/**
 * Local <-> UTC conversion for the schedule time-of-day pickers
 * (schedules-section.tsx). `scheduled_scans` stores everything in UTC
 * (preferred_hour_utc / preferred_day_of_week / preferred_day_of_month, see
 * lib/scanner/schedule-timing.ts), but the pickers themselves hold
 * whatever the user selects in their own timezone -- the parent component
 * converts to UTC once, at submit time, via the helpers below. This
 * mirrors the same "convert with the browser's own Date math, no timezone
 * library" approach lib/notifications/local-datetime.ts already uses for
 * the admin notifications datetime-local fields.
 *
 * `now` is an injectable reference point (defaults to `new Date()`) purely
 * so these are unit-testable without depending on the test runner's
 * timezone or the actual wall-clock date.
 */

/** Label for an hour-of-day <option>, given a LOCAL hour (0-23). */
export function localHourLabel(
  hourLocal: number,
  now: Date = new Date(),
): string {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hourLocal,
  );
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Convert a locally-selected hour (0-23) into the UTC hour to store. */
export function localHourToUtc(
  hourLocal: number,
  now: Date = new Date(),
): number {
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hourLocal,
    0,
    0,
    0,
  );
  return d.getUTCHours();
}

/**
 * Convert a locally-selected (day-of-week, hour) pair into UTC. Computed
 * jointly, not independently, because a late-night local selection can fall
 * on the *next* UTC day (or the previous one, in a positive offset) --
 * treating the two pickers separately would silently pick the wrong day for
 * anyone not near UTC.
 */
export function localHourAndDowToUtc(
  hourLocal: number,
  dowLocal: number,
  now: Date = new Date(),
): { hourUtc: number; dowUtc: number } {
  const diff = (dowLocal - now.getDay() + 7) % 7;
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + diff,
    hourLocal,
    0,
    0,
    0,
  );
  return { hourUtc: d.getUTCHours(), dowUtc: d.getUTCDay() };
}

/**
 * Convert a locally-selected (day-of-month, hour) pair into UTC, same
 * joint-conversion reasoning as localHourAndDowToUtc. Both the input and
 * the output day-of-month are clamped to 1-28 -- scheduled_scans only ever
 * stores a day that exists in every month (see schedule-timing.ts), and a
 * date near a month boundary can shift by at most one day when crossing
 * into UTC, which the clamp on the way out absorbs.
 */
export function localHourAndDomToUtc(
  hourLocal: number,
  domLocal: number,
  now: Date = new Date(),
): { hourUtc: number; domUtc: number } {
  const clampedDom = Math.min(28, Math.max(1, Math.trunc(domLocal) || 1));
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    clampedDom,
    hourLocal,
    0,
    0,
    0,
  );
  return {
    hourUtc: d.getUTCHours(),
    domUtc: Math.min(28, Math.max(1, d.getUTCDate())),
  };
}
