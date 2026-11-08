/**
 * Strict parsers for the two kinds of id a request path can carry.
 *
 * Imports nothing, so a route test that replaces lib/api/api-utils or the
 * database still runs the real thing.
 */

const NUMERIC_ID = /^[1-9][0-9]{0,9}$/;
const PUBLIC_SCAN_ID = /^[0-9a-f]{32}$/;

/** The largest value a Postgres INTEGER column holds. */
const MAX_INT4 = 2147483647;

/**
 * A positive integer id, or null for anything that is not exactly one.
 *
 * Number.parseInt reads as far as it can, so "12.png", "12abc" and "1e3" came
 * back as 12, 12 and 1, and the handler then served whichever row that named.
 * A value past INT4 passed too, and came back from Postgres as a 500 on the
 * cast. Leading zeros are refused so that one row has one spelling.
 */
export function parseIdParam(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !NUMERIC_ID.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_INT4 ? id : null;
}

/** The opaque id scan_history.public_id holds: 32 lowercase hex characters. */
export function isPublicScanId(raw: unknown): raw is string {
  return typeof raw === "string" && PUBLIC_SCAN_ID.test(raw);
}
