import {
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
} from "@/lib/config/config-values";

/**
 * Query-string pagination.
 *
 * Its own module rather than part of lib/api/request-utils.ts, which is where
 * it first landed. Everything in request-utils reads the live request through
 * next/headers, so every route test that touches it replaces the whole module
 * with a stub carrying just the one or two functions that test knows about.
 * A pure function of URLSearchParams put in there is undefined the moment any
 * of those stubs is in play - five suites went from 200 to 500 on exactly
 * that. Pagination needs no request context at all, so it does not belong
 * behind that mock boundary.
 */

/**
 * Read `?page` and `?limit` off a query string and turn them into a page,
 * a clamped limit, and the SQL OFFSET they imply.
 *
 * Promoted from a local copy in app/api/v3/admin/content/route.ts, which was
 * the only one of six that got every edge right. The other five had each been
 * written separately, and three of them shared a bug that a crafted query
 * string reaches:
 *
 *   admin/teams had no floor on `page` at all, so `?page=0` produced
 *   OFFSET -10 and `?page=-5` produced OFFSET -60. Postgres rejects a
 *   negative OFFSET, so that is a 500 from a query string.
 *
 *   ai/conversations and the admin user list wrote `Math.max(1, parseInt(x))`
 *   and `Math.max(1, Number(x))` with no fallback for the non-numeric case.
 *   Math.max(1, NaN) is NaN, not 1 - so `?page=abc` sent NaN into the offset
 *   rather than falling back to the first page.
 *
 * Every value is forced through `positiveIntParam`, so a missing, empty,
 * non-numeric, zero, negative or fractional input lands on the fallback
 * instead of travelling into SQL.
 *
 * `page` is also capped. Without it `?page=1e21` parses to a finite number,
 * multiplies into an offset past the range Postgres accepts for a bigint, and
 * fails the same way the negative offset did. A million pages is beyond any
 * listing this product will ever hold, so clamping there costs nothing real.
 *
 * `defaultLimit` and `maxLimit` exist because the call sites genuinely differ:
 * the AI conversation list pages at 50 and admits 200, the admin lists page at
 * 10, and the rest use the CONFIG_PAGINATION_* values. Those differences are
 * intentional, so the helper takes them rather than flattening them.
 */
export function positiveIntParam(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A million pages. See the note on `page` above. */
const MAX_PAGE = 1_000_000;

export function parsePagination(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; offset: number } {
  const defaultLimit =
    options.defaultLimit ?? CONFIG_PAGINATION_DEFAULT_PAGE_SIZE;
  const maxLimit = options.maxLimit ?? CONFIG_PAGINATION_MAX_PAGE_SIZE;

  const page = Math.min(
    MAX_PAGE,
    positiveIntParam(searchParams.get("page"), 1),
  );
  const limit = Math.min(
    maxLimit,
    positiveIntParam(searchParams.get("limit"), defaultLimit),
  );

  return { page, limit, offset: (page - 1) * limit };
}
