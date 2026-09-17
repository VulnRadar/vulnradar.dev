/**
 * Absolute dates, one format each, for every surface that prints one.
 *
 * Relative times ("5m ago") live in lib/ui/relative-time.ts. These are the
 * absolute ones, and they had been written locally at least nine times with
 * slightly different options (month and day only, with or without the year,
 * with or without the time, and two with no locale at all that printed
 * "9/16/2026" on one machine and "16/09/2026" on the next). en-US on purpose:
 * the rest of the product's copy is US English, and a date that changes shape
 * with the viewer's browser is the drift this replaced.
 */

function valid(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Sep 16, 2026". */
export function formatDate(value: string | Date): string {
  const date = valid(value);
  if (!date) return "Unknown date";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Sep 16, 2026, 08:07 AM". Seconds for log lines where they matter. */
export function formatDateTime(
  value: string | Date,
  withSeconds = false,
): string {
  const date = valid(value);
  if (!date) return "Unknown date";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
}

/** "Sep 16", for a dense row where the year is implied. */
export function formatMonthDay(value: string | Date): string {
  const date = valid(value);
  if (!date) return "Unknown date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
