/**
 * The WHERE clause behind GET /api/v3/history.
 *
 * Search and tag filtering used to run in the browser, over whatever page the
 * history view had already loaded (the endpoint caps rows at
 * HISTORY_LIST_MAX_ROWS). So a scan still inside the plan's retention window
 * could not be found by URL once it had scrolled past that page: the search
 * box answered "no match" for a scan that exists. ref: AUDIT-014#qolf-01
 *
 * It lives here rather than inline in the route for one reason: the unit tier
 * fakes `pool.query`, so a suite there can only compare SQL strings, and every
 * interesting property of this clause is a property of what PostgreSQL does
 * with it. With the builder as its own module, tests/integration can run the
 * production clause against a real database and prove the two things that
 * actually matter: that `ESCAPE` makes a `%` in the search box a literal
 * rather than "every row I own", and that neither filter can reach another
 * user's scans.
 *
 * Nothing here is concatenated from user input. Values are bound; only the
 * parameter numbers are interpolated.
 */

export interface HistoryFilterInput {
  userId: number;
  /** Days of history the caller's plan keeps. <= 0 means unlimited. */
  retentionDays: number;
  /** Case-insensitive substring of the scanned URL, or null for no filter. */
  q: string | null;
  /** Exact tag on one of the caller's own scan_tags rows, or null. */
  tag: string | null;
}

export interface HistoryFilter {
  /**
   * Ownership plus retention, with no search applied. The account total the
   * delete-everything confirmation counts is measured against this, so it must
   * stay blind to q/tag.
   */
  baseWhere: string;
  baseParams: unknown[];
  /** baseWhere plus whichever of q/tag were given. */
  where: string;
  params: unknown[];
  /** Whether `where` differs from `baseWhere`. */
  filtering: boolean;
}

/**
 * Escape the LIKE metacharacters so the search is a literal substring.
 *
 * Without this a "_" typed into the search box matches any single character
 * and a bare "%" matches every row the caller owns, which turns a search into
 * a full listing. Paired with `ESCAPE '\'` in the clause below, and the same
 * one-liner the admin user, team, error-log and email-log searches use.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function buildHistoryFilter({
  userId,
  retentionDays,
  q,
  tag,
}: HistoryFilterInput): HistoryFilter {
  // GitHub repo scans (sh.scan_type = 'github') are excluded: they get their
  // own dedicated history at /repos, scoped per-repo instead of mixed into
  // this URL-scan list. The DELETE handler carries the same exclusion.
  const baseParams: unknown[] = [userId];
  let baseWhere =
    "sh.user_id = $1 AND (sh.scan_type IS NULL OR sh.scan_type != 'github')";
  if (retentionDays > 0) {
    baseParams.push(Math.floor(retentionDays));
    baseWhere += `\n         AND sh.scanned_at > NOW() - ($${baseParams.length} * INTERVAL '1 day')`;
  }

  const params: unknown[] = [...baseParams];
  let where = baseWhere;
  if (q !== null) {
    params.push(`%${escapeLikePattern(q)}%`);
    where += `\n         AND sh.url ILIKE $${params.length} ESCAPE '\\'`;
  }
  if (tag !== null) {
    // st_f.user_id = $1 as well as the scan join. Tags are per-user rows, so
    // matching on the join alone would let one user's tag on a URL select
    // another user's scan of it.
    params.push(tag);
    where += `\n         AND EXISTS (SELECT 1 FROM scan_tags st_f WHERE st_f.scan_id = sh.id AND st_f.user_id = $1 AND st_f.tag = $${params.length})`;
  }

  return {
    baseWhere,
    baseParams,
    where,
    params,
    filtering: q !== null || tag !== null,
  };
}
