/**
 * A row id out of a JSON body or a query string: a whole number, or the digits
 * of one. Anything else is null, so the caller can answer 400 instead of
 * handing Postgres a string it rejects with 22P02 (a 500 that names no one).
 * The upper bound is the INTEGER column's own, for the same reason.
 */
export function parseRowId(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{1,10}$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}
