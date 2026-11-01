/**
 * SQL expressions over scan_history.url that a query and an index must agree on.
 *
 * Why this is a .mjs under schema/ and not only lib/database/sql-fragments.ts:
 * the boot schema is executed by plain Node (`npm run db:create` imports it with
 * no build step), so it cannot import TypeScript. The expression an index is
 * built on and the expression a query filters by have to be the same tree for
 * the planner to use the index at all, so there is exactly one copy of each,
 * here, imported by the schema steps and re-exported for the app through
 * lib/database/sql-fragments.ts.
 *
 * Nothing in this file touches a database.
 */

/**
 * The hostname, lowercased, out of a stored URL column.
 *
 * Skips userinfo and stops at the port, the path, a bare query string and a
 * fragment. Each of those is a place a looser expression went wrong:
 *
 *   https://evil.com:8443/x      the port is not part of the host
 *   https://evil.com?next=a.b    a query string without a path is still a query
 *   https://x.victim.com:pw@evil.com/
 *                                the host is evil.com, not what precedes the
 *                                colon of the userinfo
 *   https://evil.com/a@b.com     an @ after the first slash belongs to the path
 *   https://evil.com\@victim.com/
 *                                no host at all: see below
 *
 * The userinfo group is `[^/?#\\]*@`, which may itself contain colons and
 * further @ signs, and the host class excludes @. A URL parser takes the host
 * after the LAST @ of the authority; because the host cannot contain one, the
 * longest overall match is the one that spends every @ on userinfo, whichever
 * way the engine prefers to break ties.
 *
 * A backslash in the authority is the one case the expression cannot get
 * right, so it answers NULL instead. For http and https the URL parser that
 * fetches the target reads a backslash as a slash, so the stored string above
 * was a scan of evil.com; for ssh:// and the other non-special schemes it is
 * an ordinary userinfo character, so ssh://victim.com\@evil.com reached
 * evil.com too. Taking either side would let a scan of one site be listed,
 * counted and purged as another. No class crosses a backslash and the
 * lookahead requires the authority to end cleanly, so such a row matches
 * nothing. New rows never hold one: normalizeUrl stores what the parser reads.
 *
 * Inside a bracket expression of a Postgres ARE a literal backslash is written
 * `\\`, and the SQL string literal carries both characters through unchanged
 * because standard_conforming_strings is on (the server default since 9.1, and
 * what the backup preamble in scripts/_lib/_lib.sql-backup.mjs sets).
 *
 * `substring(x from pattern)` returns the first capturing group, and the (?:...)
 * groups do not capture, so the result is the host alone.
 *
 * @param {string} column A column or qualified column holding a URL, as SQL.
 * @returns {string}
 */
export function hostOfUrlSql(column) {
  return `LOWER(substring(${column} from '^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[^/?#\\\\]*@)?([^/:?#@\\\\]+)(?::[^/?#\\\\]*)?(?=[/?#]|$)'))`;
}

/**
 * The host a public report is keyed on: lowercased, with one leading "www."
 * removed, so www.example.com and example.com are one site.
 *
 * Written against the bare column `url` because it is the expression of an
 * index on scan_history, and an index expression cannot carry a table alias. A
 * query that aliases the table still matches the index: the planner compares
 * expression trees, and a column reference is the same attribute of the same
 * relation whatever it was called in the query text.
 *
 * `[.]` rather than an escaped dot, so the only backslashes on the way to the
 * server are the two hostOfUrlSql needs.
 */
export const PUBLIC_HOST_SQL = `regexp_replace(${hostOfUrlSql("url")}, '^www[.]', '')`;

/**
 * The stored URL with its query string and fragment cut off, so
 * https://example.com/page?utm=1#top reads as https://example.com/page.
 *
 * The browser extension asks about a page by origin and path only, because the
 * query string and fragment are where session tokens and personal data live and
 * it does not send them. A scan that was stored with one would never equal that
 * lookup. Nothing else is normalised here: the host is not lowercased and a
 * trailing slash is kept, so a caller compares against both slash variants.
 *
 * Bare `url` for the same reason as PUBLIC_HOST_SQL.
 */
export const URL_ORIGIN_PATH_SQL = `substring(url from '^[^?#]*')`;
