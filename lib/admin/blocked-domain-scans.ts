import pool from "@/lib/database/db";
import { hostOfUrlSql } from "@/lib/database/sql-fragments";
import { purgeScansWhere } from "@/lib/admin/purge-user-scans";

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

/**
 * Reduce a pasted value to the bare hostname, so "https://EVIL.com:8443/x?y#z"
 * is "evil.com". The search compares against the host of each stored URL, which
 * has no scheme, userinfo, port, path, query or fragment, so a value that kept
 * any of them would match nothing.
 */
export function normalizeBlockedDomain(value: string): string {
  let normalized = value.trim().toLowerCase();
  const protoEnd = normalized.indexOf("://");
  // A scheme only if nothing that ends a host comes before it. Without the
  // check "evil.com/r?u=http://victim.com" read as the host victim.com, and
  // the purge that follows deletes every account's scans of the wrong domain.
  if (protoEnd !== -1 && !/[/?#]/.test(normalized.slice(0, protoEnd))) {
    normalized = normalized.slice(protoEnd + 3);
  }
  normalized = normalized.split(/[/?#]/, 1)[0];
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex !== -1) normalized = normalized.slice(atIndex + 1);
  return normalized.replace(/:\d*$/, "");
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

/**
 * Up to 100 most recent scans of the domain, or of any subdomain of it.
 *
 * An empty domain matches nothing. normalizeBlockedDomain returns one for a
 * value that was only a port, a query, a fragment or userinfo, and the
 * subdomain arm of an empty name is the pattern "%.", which every host that
 * ends in a dot would satisfy.
 */
export async function findScansForBlockedDomain(
  domain: string,
): Promise<BlockedDomainScanRow[]> {
  if (!domain) return [];
  const host = hostOfUrlSql("sh.url");
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
 * Delete them, and say how many scans went.
 *
 * Same two arms and the same escaped pattern as the search above. They used
 * to differ: the search passed the raw value to its LIKE while the delete
 * passed an escaped one, so an admin searching "%.com" was shown every .com
 * scan in the database and then deleted none of them.
 *
 * An empty domain deletes nothing, for the reason given on the search.
 */
export async function deleteScansForBlockedDomain(
  domain: string,
): Promise<number> {
  if (!domain) return 0;
  const host = hostOfUrlSql("url");
  // Through the shared purge, not a bare DELETE: the host reports these scans
  // sourced would otherwise be orphaned and keep serving the blocked domain's
  // findings on /host/<hostname> (see lib/admin/purge-user-scans.ts).
  const purged = await purgeScansWhere(`${host} = $1 OR ${host} LIKE $2`, [
    domain,
    likePattern(domain),
  ]);
  return purged.scans;
}
