/**
 * The scan time in a report, rendered the same way wherever the report is
 * built.
 *
 * toLocaleString with no timeZone reads the machine's zone, so one scan came
 * out with a different clock time in a report downloaded from the browser (the
 * viewer's zone) and one built by the API (the server's zone), and neither said
 * which zone it meant. UTC with the zone named is the one reading that is the
 * same for every reader.
 *
 * Imports nothing, so the client bundle that builds a PDF in the browser and
 * the route that builds it on the server share one definition.
 */

const UNKNOWN = "Unknown";
const ZONE = "UTC";

type Instant = string | number | Date | null | undefined;

function toDate(value: Instant): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ICU 72 started separating the time from AM/PM with U+202F. A report is read
// as text and compared in tests, so one plain space keeps it stable across
// Node versions.
function plainSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

/** "January 15, 2026", or "Thursday, January 15, 2026" with `weekday`. */
export function formatReportDate(
  value: Instant,
  options: { weekday?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return UNKNOWN;
  return plainSpaces(
    date.toLocaleDateString("en-US", {
      timeZone: ZONE,
      ...(options.weekday ? { weekday: "long" } : {}),
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  );
}

/** "11:30 PM UTC", or "11:30:00 PM UTC" with `seconds`. */
export function formatReportTime(
  value: Instant,
  options: { seconds?: boolean } = {},
): string {
  const date = toDate(value);
  if (!date) return UNKNOWN;
  const time = date.toLocaleTimeString("en-US", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
  });
  return `${plainSpaces(time)} ${ZONE}`;
}

/** "January 15, 2026, 11:30 PM UTC". */
export function formatReportDateTime(value: Instant): string {
  const date = toDate(value);
  if (!date) return UNKNOWN;
  return `${formatReportDate(date)}, ${formatReportTime(date)}`;
}
