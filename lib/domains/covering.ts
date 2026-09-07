/**
 * The zone-control rule, with no database attached.
 *
 * Split out of lib/domains/scope.ts, which imports `pg` at module scope and so
 * cannot be reached from a client component at all. The rule itself is pure
 * string work, and the browser needs it for the same reason the server does:
 * the scan form has to tell you whether the host you typed is covered by a
 * domain you have verified BEFORE you submit a port sweep, rather than after
 * the API has refused the whole scan.
 *
 * scope.ts imports from here, so there is still exactly one implementation and
 * the gate the server actually enforces cannot drift from the hint the form
 * shows.
 */

/**
 * Every domain that would cover `host`: the host itself plus each of its
 * parent suffixes. `a.b.example.com` yields a.b.example.com, b.example.com,
 * example.com, com.
 *
 * Verifying `example.com` covers every subdomain under it by convention, the
 * same DNS-zone-control model every mainstream domain-verification system uses
 * (Google Search Console, ACME DNS-01): whoever can publish a TXT record at
 * the parent controls the whole zone underneath it. It does NOT cover a
 * different registrable domain, even one the target redirects to.
 *
 * This exists as a candidate LIST rather than a pattern so the lookup can be
 * an equality test against a small array instead of
 * `$1 = domain OR $1 LIKE '%.' || domain`. That predicate builds its LIKE
 * pattern FROM the column with the parameter on the left, which no b-tree can
 * serve, so idx_domains_domain_verified was unusable and the gate scanned
 * every verified domain across all tenants on every authorization check
 * (AUDIT-012#perf-16).
 *
 * It also closes a latent correctness hole: `_` and `%` are LIKE wildcards, so
 * a stored domain containing an underscore matched hosts it does not own.
 * Equality has no such reading.
 */
export function coveringDomainCandidates(host: string): string[] {
  const labels = host.split(".").filter(Boolean);
  const candidates: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    candidates.push(labels.slice(i).join("."));
  }
  return candidates;
}

/**
 * Whether any of `verifiedDomains` covers `host` under the rule above.
 *
 * The client-side twin of findVerifiedDomainForHost's SQL. It answers the same
 * question against a list already fetched from GET /api/v3/domains, and it is
 * a HINT ONLY: the server re-runs the real check against the database on every
 * request, and that is the thing that actually refuses the work.
 */
export function domainListCovers(
  host: string,
  verifiedDomains: readonly string[],
): boolean {
  if (!host) return false;
  const candidates = new Set(coveringDomainCandidates(host.toLowerCase()));
  return verifiedDomains.some((d) => candidates.has(d.toLowerCase()));
}

/**
 * The hostname a user's typed scan target resolves to, or null.
 *
 * The scan form accepts what the API accepts: a bare hostname, a full URL with
 * any scheme, or a raw IPv4. `new URL()` alone rejects the bare-hostname form,
 * which is the one most people type, so a scheme is prepended when there is
 * none. Never throws.
 */
export function hostFromScanTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}
