/**
 * The most rows a client may skip. Far past any account's history, and well
 * inside what a Postgres bigint OFFSET and a JSON number both hold.
 *
 * Without it `?offset=1e21` or `?offset=99999999999999999999` reached the
 * query as a number that serialises in exponent form or past int8, and the
 * database refused it: a 500 for what is a client's out-of-range value.
 */
export const MAX_OFFSET = 100_000_000;

/**
 * Read `limit` / `offset` off the query string.
 *
 * The list has always been hard-capped at HISTORY_LIST_MAX_ROWS and has always
 * reported `total` and `truncated: true` alongside it, so an API client with
 * more scans than the cap was told there was more and given no way to ask for
 * it: page 2 did not exist (AUDIT-015#api-01). The web UI paginates in the
 * browser over the rows it already has, which is why this never showed up
 * there.
 *
 * Both parameters are optional and absence is the previous behaviour exactly
 * (first page, cap-sized), so no existing caller changes. An out-of-range or
 * unparseable value is clamped rather than rejected: this is a read, and a
 * 400 for `?limit=0` would be a worse answer than the first page.
 */
export function parsePaging(
  searchParams: URLSearchParams,
  maxRows: number,
): { limit: number; offset: number } {
  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), maxRows)
      : maxRows;

  const rawOffset = Number(searchParams.get("offset"));
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(Math.floor(rawOffset), MAX_OFFSET)
      : 0;

  return { limit, offset };
}
