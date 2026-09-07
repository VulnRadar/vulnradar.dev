/**
 * What proving you own a domain lets you do about scans of it.
 *
 * Verifying a domain already unlocks the intrusive capabilities (active
 * probing, port sweeps, authenticated scans, subdomain discovery). It did
 * nothing at all about the scans OTHER accounts run against that domain, which
 * is the half a domain owner actually cares about: anyone can point VulnRadar
 * at your site, mark the result public, and that report then appears on
 * /public-scans and on /host/<your domain> with your findings in it. The owner
 * of the domain had no say and no way to see the list.
 *
 * This module is that say. Three capabilities, all scoped to a domain the
 * caller has VERIFIED (lib/domains/scope.ts's zone-control rule, so an apex
 * covers its subdomains):
 *
 *   1. See every scan of the domain that is publicly reachable, whoever ran it.
 *   2. Take those out of public view: unpublish, and revoke share links.
 *   3. Block the domain from being scanned at all.
 *
 * What it deliberately does NOT do is delete another account's scan. The
 * report is their record of work they did; the PUBLICITY of it is what touches
 * your domain, and that is the part that is yours to withdraw. Unpublishing
 * removes it from /public-scans, from /host, and from the host reputation
 * aggregate, and leaves the row in its owner's own private history. That line
 * is the whole design: an owner controls exposure, not other people's data.
 *
 * Blocking is the same mechanism the admin blocklist uses (access_rules, a
 * 'url' blacklist row), because it is the same thing: "do not scan this". A
 * url rule covers the domain and every subdomain, which is exactly the scope
 * verification proved. Owner-created rules record created_by, and an owner may
 * only lift a rule they created themselves: a staff block stays a staff block.
 */

import pool from "@/lib/database/db";
import { coveringDomainCandidates } from "./covering";
import { clearAccessRulesCache } from "@/lib/scanner/access-rules";

export interface OwnedDomain {
  id: number;
  domain: string;
}

/**
 * The verified domain `domainId` names, if the caller may act on it.
 *
 * Ownership here is the row's own user_id, NOT team membership. Every other
 * domain read in the app lets a teammate see the row, and that is right for
 * reading. This gates unpublishing other people's scans and switching off
 * scanning for a whole zone, so it stays with the account that proved the
 * ownership rather than spreading to everyone who shares a team with them.
 */
export async function resolveOwnedDomain(
  domainId: number,
  userId: number,
): Promise<OwnedDomain | null> {
  const result = await pool.query<{ id: number; domain: string }>(
    `SELECT id, domain
       FROM domains
      WHERE id = $1 AND user_id = $2 AND status = 'verified'`,
    [domainId, userId],
  );
  return result.rows[0] ?? null;
}

export interface DomainScan {
  /** Opaque handle, the one the URLs use. */
  publicId: string;
  url: string;
  scannedAt: string;
  findingsCount: number;
  summary: Record<string, number>;
  isPublic: boolean;
  /** An unlisted share link exists for this scan. */
  hasShareLink: boolean;
  /** The caller ran this one. Nothing else is said about who did. */
  isOwnScan: boolean;
}

/**
 * The SQL fragment matching scan_history rows whose host is covered by
 * `domain`, as `$n` = the domain.
 *
 * The same two-part test lib/scanner/access-rules.ts uses for a 'url' rule:
 * the host itself, or anything ending in ".<domain>". It has to run against
 * the hostname pulled out of the stored URL rather than against the URL, or
 * "https://evil.com/?x=example.com" would match.
 *
 * substring() with a POSIX class rather than a regexp_replace chain: the URL
 * column holds full URLs with schemes, ports, paths and query strings, and
 * this pulls out just the host between "://" and the first "/", ":" or "?".
 */
const HOST_OF_URL = `LOWER(substring(sh.url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)'))`;

/**
 * Every publicly reachable scan of this domain, from any account.
 *
 * "Publicly reachable" is the point of the list, so it is exactly the rows a
 * stranger could already read: is_public rows (which appear on /public-scans
 * and /host) and rows carrying a share_token (unlisted, but anyone with the
 * link). A private scan someone else ran against the domain is NOT listed:
 * that is their own record and it exposes nothing about the domain to anyone.
 * Showing it would turn domain verification into a surveillance tool over
 * other accounts, which is the opposite of what it is for.
 */
export async function listDomainScans(
  domain: string,
  userId: number,
  limit: number,
): Promise<DomainScan[]> {
  const result = await pool.query<{
    public_id: string;
    url: string;
    scanned_at: string;
    findings_count: number;
    summary: Record<string, number> | null;
    is_public: boolean;
    has_share_link: boolean;
    is_own_scan: boolean;
  }>(
    `SELECT sh.public_id, sh.url, sh.scanned_at, sh.findings_count, sh.summary,
            sh.is_public,
            (sh.share_token IS NOT NULL) AS has_share_link,
            (sh.user_id = $2) AS is_own_scan
       FROM scan_history sh
      WHERE (sh.is_public = true OR sh.share_token IS NOT NULL)
        AND sh.public_id IS NOT NULL
        AND (${HOST_OF_URL} = LOWER($1)
             OR ${HOST_OF_URL} LIKE '%.' || LOWER($1))
      ORDER BY sh.scanned_at DESC
      LIMIT $3`,
    [domain, userId, limit],
  );

  return result.rows.map((row) => ({
    publicId: row.public_id,
    url: row.url,
    scannedAt: row.scanned_at,
    findingsCount: row.findings_count,
    summary: row.summary ?? {},
    isPublic: row.is_public,
    hasShareLink: row.has_share_link,
    isOwnScan: row.is_own_scan,
  }));
}

export type DomainScanAction = "unpublish" | "revoke-shares";

export interface DomainScanActionResult {
  /** Rows actually changed. Zero is a normal answer, not a failure. */
  affected: number;
}

/**
 * Withdraw public exposure of scans of this domain.
 *
 * `unpublish` clears is_public AND deletes the host_reputation snapshot the
 * scan produced. Both halves are needed and only the first was here: /host is
 * served from host_reputation, which holds its OWN copy of the findings,
 * response headers and result_meta (see lib/scanner/host-reputation.ts's
 * upsertHostReputation). Clearing is_public alone took the scan off nothing a
 * visitor can see. An owner pressed "Take out of public view", got
 * {affected: N} back, and every finding stayed live on /host/<their domain>
 * for anyone, permanently, with no lever left: they do not own the scan row,
 * so the working purge on PATCH /api/v3/history/[id] is closed to them.
 *
 * A privacy control that reports success and does nothing is worse than one
 * that is missing.
 *
 * `revoke-shares` clears share_token, which kills every unlisted
 * /shared/<token> link AND removes the scan from /public-scans, which is
 * gated on share_token rather than on is_public.
 *
 * Both leave the row intact in its owner's private history, and both are
 * scoped by the same host match the listing uses, so this can never touch a
 * scan of a domain the caller has not verified.
 *
 * `publicIds` narrows it to specific scans; omitting it applies to every
 * covered scan, which is the "take my domain out of public view" case.
 */
export async function applyDomainScanAction(
  domain: string,
  action: DomainScanAction,
  publicIds: string[] | null,
): Promise<DomainScanActionResult> {
  const setClause =
    action === "unpublish" ? "is_public = false" : "share_token = NULL";
  // The precondition matters as much as the SET: without it, "unpublish all"
  // reports every covered scan as affected every time it runs, including the
  // ones that were already private.
  const alreadyDone =
    action === "unpublish"
      ? "sh.is_public = true"
      : "sh.share_token IS NOT NULL";

  const params: unknown[] = [domain];
  let idFilter = "";
  if (publicIds && publicIds.length > 0) {
    params.push(publicIds);
    idFilter = ` AND sh.public_id = ANY($${params.length}::text[])`;
  }

  // One statement, so the flag and the public snapshot cannot end up
  // disagreeing: a second query could fail after the first committed and
  // leave the scan private while /host still served it.
  //
  // The DELETE is scoped by source_scan_id from the same CTE, so it can only
  // remove a snapshot produced by a scan this action just changed. It is a
  // no-op for revoke-shares, which does not change what /host serves.
  const purge =
    action === "unpublish"
      ? `, purged AS (
        DELETE FROM host_reputation
         WHERE source_scan_id IN (SELECT id FROM changed)
      )`
      : "";

  const result = await pool.query(
    `WITH changed AS (
        UPDATE scan_history sh
           SET ${setClause}
         WHERE ${alreadyDone}
           AND (${HOST_OF_URL} = LOWER($1)
                OR ${HOST_OF_URL} LIKE '%.' || LOWER($1))${idFilter}
        RETURNING sh.id
      )${purge}
      SELECT COUNT(*)::int AS affected FROM changed`,
    params,
  );

  return { affected: result.rows[0]?.affected ?? 0 };
}

export interface DomainBlock {
  ruleId: number;
  reason: string | null;
  createdAt: string;
  /** The caller created this rule and may therefore lift it. */
  liftable: boolean;
}

/**
 * The active blacklist rule covering this domain, if there is one.
 *
 * Reported whoever created it, so an owner is told their domain is blocked
 * rather than being shown a Block button that does nothing. `liftable` is what
 * separates the two cases: a rule this account created can be lifted here, a
 * staff-created one cannot and says so.
 */
export async function readDomainBlock(
  domain: string,
  userId: number,
): Promise<DomainBlock | null> {
  const result = await pool.query<{
    id: number;
    reason: string | null;
    created_at: string;
    created_by: number | null;
  }>(
    `SELECT id, reason, created_at, created_by
       FROM access_rules
      WHERE rule_type = 'blacklist'
        AND value_type = 'url'
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND LOWER(value) = ANY($1::text[])
      ORDER BY (created_by = $2) DESC, id ASC
      LIMIT 1`,
    // A parent's rule blocks this domain too, so the lookup asks about every
    // covering name rather than only the exact one. Reporting "not blocked"
    // for a domain whose apex is blocked would be a lie the scan API then
    // contradicts.
    [coveringDomainCandidates(domain.toLowerCase()), userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ruleId: row.id,
    reason: row.reason,
    createdAt: row.created_at,
    liftable: row.created_by === userId,
  };
}

/**
 * Stop anyone scanning this domain, or any host under it.
 *
 * One 'url' blacklist row, the same shape and the same enforcement path as an
 * admin block: checkAccessRules refuses the target before any scan starts, on
 * every route.
 *
 * ON CONFLICT REACTIVATES rather than doing nothing. A row can exist and not
 * be in force: staff can deactivate one, or give it an expires_at that has
 * since lapsed, and checkAccessRules honours only active unexpired rules. With
 * DO NOTHING the insert was skipped, readDomainBlock (which filters on the
 * same two conditions) found nothing, and the route answered 200 with
 * block: null, which is exactly what "not blocked" looks like. The owner
 * pressed the button, was shown no block, and scanning of their domain
 * carried on.
 *
 * created_by is deliberately NOT updated on the conflict path: an owner may
 * revive a lapsed rule but must not become the owner of a staff one, because
 * unblockDomain keys on created_by and that would let them lift it.
 *
 * The rule memo has a 30 second TTL, so it is cleared here rather than left to
 * expire: an owner who has just switched scanning off should not watch scans
 * of their domain succeed for the next half minute.
 */
export async function blockDomain(
  domain: string,
  userId: number,
  reason: string,
): Promise<DomainBlock | null> {
  await pool.query(
    `INSERT INTO access_rules
       (rule_type, value_type, value, description, reason, created_by)
     VALUES ('blacklist', 'url', LOWER($1), $2, $3, $4)
     ON CONFLICT (rule_type, value_type, value) DO UPDATE
       SET is_active = true,
           expires_at = NULL,
           reason = EXCLUDED.reason
     WHERE access_rules.is_active = false
        OR access_rules.expires_at <= NOW()`,
    [domain, `Blocked by the verified owner of ${domain}.`, reason, userId],
  );
  clearAccessRulesCache();
  return readDomainBlock(domain, userId);
}

/**
 * Lift a block this account created.
 *
 * Scoped by created_by as well as by value: an owner may undo their own
 * decision and may not undo a staff one. A staff block exists because someone
 * decided this target should not be scanned from here, and a domain owner
 * proving they own the domain is not an answer to that.
 */
export async function unblockDomain(
  domain: string,
  userId: number,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM access_rules
      WHERE rule_type = 'blacklist'
        AND value_type = 'url'
        AND LOWER(value) = LOWER($1)
        AND created_by = $2`,
    [domain, userId],
  );
  clearAccessRulesCache();
  return (result.rowCount ?? 0) > 0;
}
