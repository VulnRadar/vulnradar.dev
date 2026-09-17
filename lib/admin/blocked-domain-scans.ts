import pool from "@/lib/database/db";

/**
 * Finding and purging every cached scan of a blocked domain.
 *
 * This is the one admin action that deletes rows belonging to every user at
 * once, by design: a domain nobody may scan should not leave its results in
 * other people's history. That makes the match itself the whole of the
 * safety, and the match is a Postgres regex plus a LIKE pattern, which is
 * exactly the kind of correctness a mocked pool cannot answer for. It lives
 * here rather than inline in app/api/v3/admin/blocked-data/route.ts so
 * tests/integration/blocked-domain-scans.test.ts can run it against real rows
 * without a staff session.
 */

/** The hostname, lowercased, out of a stored URL column. */
function hostnameOf(column: string): string {
  return `LOWER(REGEXP_REPLACE(${column}, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1'))`;
}

/** Strip a protocol and any path, so "https://EVIL.com/x" is "evil.com". */
export function normalizeBlockedDomain(value: string): string {
  let normalized = value.trim().toLowerCase();
  const protoEnd = normalized.indexOf("://");
  if (protoEnd !== -1) normalized = normalized.slice(protoEnd + 3);
  const pathIndex = normalized.indexOf("/");
  if (pathIndex !== -1) normalized = normalized.slice(0, pathIndex);
  return normalized;
}

/**
 * The subdomain arm's LIKE pattern, with LIKE's own metacharacters escaped.
 *
 * Without this, a blocked value of "%.com" expands into a wildcard and the
 * subdomain arm matches every .com host anyone has ever scanned, and
 * "x_evil.com" quietly also matches "xyevil.com". Backslash is PostgreSQL's
 * default LIKE escape character, so it has to be escaped first and therefore
 * comes first in the class.
 */
function likePattern(domain: string): string {
  return `%.${domain.replace(/[\\%_]/g, "\\$&")}`;
}

export interface BlockedDomainScanRow {
  id: number;
  url: string;
  source: string | null;
  scanned_at: string | Date;
  user_id: number | null;
  user_email: string | null;
}

/** Up to 100 most recent scans of the domain, or of any subdomain of it. */
export async function findScansForBlockedDomain(
  domain: string,
): Promise<BlockedDomainScanRow[]> {
  const host = hostnameOf("sh.url");
  const { rows } = await pool.query<BlockedDomainScanRow>(
    `SELECT sh.id, sh.url, sh.source, sh.scanned_at, sh.user_id,
            u.email AS user_email
       FROM scan_history sh
       LEFT JOIN users u ON sh.user_id = u.id
      WHERE ${host} = $1 OR ${host} LIKE $2
      ORDER BY sh.scanned_at DESC
      LIMIT 100`,
    [domain, likePattern(domain)],
  );
  return rows;
}

/**
 * Delete them, and say how many.
 *
 * Same two arms and the same escaped pattern as the search above. They used
 * to differ: the search passed the raw value to its LIKE while the delete
 * passed an escaped one, so an admin searching "%.com" was shown every .com
 * scan in the database and then deleted none of them.
 */
export async function deleteScansForBlockedDomain(
  domain: string,
): Promise<number> {
  const host = hostnameOf("url");
  const result = await pool.query(
    `DELETE FROM scan_history
      WHERE ${host} = $1 OR ${host} LIKE $2`,
    [domain, likePattern(domain)],
  );
  return result.rowCount ?? 0;
}
