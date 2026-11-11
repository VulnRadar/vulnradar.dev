import { toLocalDatetimeInputValue } from "@/lib/notifications/local-datetime";

/**
 * The value for the gift expiry field, from the stored ISO instant.
 *
 * A datetime-local input reads its string as local wall-clock time, so the
 * stored UTC instant has to be converted to local before it goes in. Slicing
 * `toISOString()` put UTC digits in a field the browser reads as local: for an
 * admin in New York, a gift ending 15:30 UTC opened as 15:30 local, and saving
 * it without touching the date moved the expiry five hours later, every time
 * the modal was opened and saved.
 */
export function giftEndDateInputValue(
  endDate: string | null | undefined,
): string {
  if (!endDate) return "";
  const date = new Date(endDate);
  return Number.isNaN(date.getTime()) ? "" : toLocalDatetimeInputValue(date);
}

/** The earliest value the expiry field accepts: the current minute, local. */
export function giftMinInputValue(now: number): string {
  return toLocalDatetimeInputValue(new Date(now));
}

/** The instant the field means, as the ISO string the route takes. */
export function giftEndDateToIso(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Whether the typed expiry is already over. The `min` attribute only guards
 * the picker: a typed value skips it, and a gift that ends in the past is not
 * a gift, it revokes the one that was running.
 */
export function giftEndDateIsPast(value: string, now: number): boolean {
  const time = new Date(value).getTime();
  return Number.isNaN(time) || time <= now;
}
