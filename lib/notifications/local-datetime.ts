/**
 * Formats a Date as the value a <input type="datetime-local"> expects:
 * local wall-clock time, no timezone suffix. Pure and client-safe: no
 * server imports, no DOM, so it can be unit-tested directly and reused
 * anywhere a datetime-local field needs "now" or an existing timestamp
 * pre-filled correctly.
 *
 * This is the fix for a real, twice-shipped regression in the admin
 * notifications "Starts at" / "Ends at" fields
 * (components/admin/notifications/notifications-manager.tsx): using
 * `date.toISOString().slice(0, 16)` instead is UTC, not local time, but a
 * datetime-local input treats whatever string it's given as local time with
 * no conversion. The mismatch compounds on save, which re-parses the
 * field's value with `new Date(value)` (again read as local time). For
 * anyone not physically in UTC, "now" round-trips through both bugs and
 * comes out shifted by the admin's own timezone offset. In negative-UTC-
 * offset regions that pushes `starts_at` into the future, so
 * `starts_at <= now` in GET /api/v3/notifications/active silently excludes
 * the notification until that offset elapses: the exact "I created it and
 * it just doesn't show up" symptom.
 */
export function toLocalDatetimeInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}
