/**
 * Scope checks: does a caller's verified-domain set actually cover a given
 * scan target? This is the gate app/api/v3/scan/route.ts and
 * app/api/v3/scan/crawl/route.ts apply before allowing the "active-probes"
 * category (real exploit-attempt payloads submitted to the target) to run.
 *
 * Verifying `example.com` covers every subdomain under it
 * (`app.example.com`, `staging.app.example.com`, ...) by convention -- the
 * same DNS-zone-control model every mainstream domain-verification system
 * uses (Google Search Console, ACME DNS-01, etc.): whoever can publish a
 * TXT record at the parent controls the whole zone underneath it. It does
 * NOT cover a different registrable domain, even one the target redirects
 * to or is CNAME'd from -- owning example.com never implies authorization
 * to intrusively probe a third-party service merely referenced by it.
 */

import pool from "@/lib/database/db";
import { getAssignableTeamIds } from "@/lib/auth/team-resource-access";

export interface VerifiedDomainMatch {
  id: number;
  domain: string;
  userId: number;
  teamId: number | null;
}

/**
 * The verified domain (the caller's own, or one assigned to a team they
 * can write into) that covers `hostname`, if any. Prefers the caller's own
 * row over a team-assigned one when both match, and the most recently
 * verified row when several of the caller's own rows match (can only
 * happen if a user manually verified both a subdomain and its parent).
 */
/**
 * Every domain that would cover `host` under the zone-control rule above:
 * the host itself plus each of its parent suffixes. `a.b.example.com`
 * yields a.b.example.com, b.example.com, example.com, com.
 *
 * This exists so the lookup can be an equality test against a small list
 * instead of `$1 = domain OR $1 LIKE '%.' || domain`. That predicate builds
 * its LIKE pattern FROM the column with the parameter on the left, which no
 * b-tree can serve, so idx_domains_domain_verified was unusable and this
 * gate scanned every verified domain across all tenants on every
 * active-probe and port-scan authorization check (AUDIT-012#perf-16).
 *
 * It also closes a latent correctness hole: `_` and `%` are LIKE wildcards,
 * so a stored domain containing an underscore matched hosts it does not
 * own. Equality has no such reading.
 */
export function coveringDomainCandidates(host: string): string[] {
  const labels = host.split(".").filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    candidates.push(labels.slice(i).join("."));
  }
  return candidates;
}

export async function findVerifiedDomainForHost(
  hostname: string,
  userId: number,
): Promise<VerifiedDomainMatch | null> {
  const host = hostname.toLowerCase();
  const candidates = coveringDomainCandidates(host);
  if (candidates.length === 0) return null;
  const assignableTeamIds = await getAssignableTeamIds(userId);

  const result = await pool.query<{
    id: number;
    domain: string;
    user_id: number;
    team_id: number | null;
  }>(
    `SELECT id, domain, user_id, team_id
     FROM domains
     WHERE status = 'verified'
       AND domain = ANY($1::text[])
       AND (user_id = $2 OR team_id = ANY($3::int[]))
     ORDER BY (user_id = $2) DESC, verified_at DESC
     LIMIT 1`,
    [candidates, userId, assignableTeamIds],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    userId: row.user_id,
    teamId: row.team_id,
  };
}

/**
 * Whether `userId` has proven ownership (directly, or via a team-assigned
 * domain) of the URL's host. Fails closed on a malformed URL or a database
 * error -- a scope check that can't run must never silently allow
 * intrusive probing, the same fail-closed stance
 * lib/scanner/access-rules.ts's checkAccessRules takes on its own DB error.
 */
export async function isUrlOwnedByUser(
  url: string,
  userId: number,
): Promise<boolean> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;

  try {
    const match = await findVerifiedDomainForHost(hostname, userId);
    return match !== null;
  } catch (err) {
    console.error("[domains] Scope check failed (failing closed):", err);
    return false;
  }
}
