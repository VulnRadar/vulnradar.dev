import pool from "@/lib/database/db";
import { APP_NAME } from "@/lib/config/constants";

export interface AccessRuleCheckResult {
  allowed: boolean;
  reason?: string;
  ruleType?: "blacklist" | "whitelist";
  matchedValue?: string;
}

// (normalizeDomain removed in cleanup; access-rules.ts now uses external normalization)

/**
 * Short-lived per-hostname memo of a completed rule evaluation.
 *
 * checkAccessRules always cost two serialized round trips (a blacklist
 * SELECT, then a whitelist COUNT), and neither predicate is sargable: the
 * url branch builds its LIKE pattern out of the column, and the ip branch
 * casts `value::inet`. So both are sequential scans of `access_rules`, on a
 * table an admin edits maybe once a month. It runs once per scan, once per
 * URL in a bulk request, and once per selected page before a crawl starts:
 * a 250-page crawl of ONE host paid 500 sequential scans to answer the same
 * question 250 times.
 *
 * The evaluation depends on nothing but the hostname (the ip branch is
 * derived from it), so the decision is memoized per hostname. The TTL is
 * deliberately short: a newly added blocklist rule takes effect within it
 * without any invalidation hook in the admin write path.
 *
 * A fail-closed result from the catch block is NEVER cached: a DB blip must
 * not pin every scan into "blocked" for the whole TTL after the database
 * has already recovered.
 * ref: AUDIT-012#perf-23
 */
const RULE_CACHE_TTL_MS = 30_000;
const RULE_CACHE_MAX_ENTRIES = 500;
const ruleCache = new Map<
  string,
  { result: AccessRuleCheckResult; cachedAt: number }
>();

/** Drop the memo. Exported for tests and for an admin write path that wants
 *  a rule change to apply immediately rather than within the TTL. */
export function clearAccessRulesCache(): void {
  ruleCache.clear();
}

function readRuleCache(hostname: string): AccessRuleCheckResult | null {
  const hit = ruleCache.get(hostname);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt >= RULE_CACHE_TTL_MS) {
    ruleCache.delete(hostname);
    return null;
  }
  return hit.result;
}

function writeRuleCache(hostname: string, result: AccessRuleCheckResult): void {
  // Map iterates in insertion order, so the first key is the oldest entry.
  // Bulk scans can touch many distinct hosts; this keeps the memo bounded.
  if (ruleCache.size >= RULE_CACHE_MAX_ENTRIES) {
    const oldest = ruleCache.keys().next().value;
    if (oldest !== undefined) ruleCache.delete(oldest);
  }
  ruleCache.set(hostname, { result, cachedAt: Date.now() });
}

/** Fire-and-forget hit accounting for a matched blacklist rule. Runs on a
 *  cached decision too, so the admin panel's hit_count stays a true count of
 *  how often the rule actually blocked something rather than dropping to one
 *  per TTL window. */
function recordBlacklistHit(value: string): void {
  pool
    .query(
      `UPDATE access_rules
       SET hit_count = hit_count + 1, last_hit_at = NOW()
       WHERE LOWER(value) = LOWER($1) AND rule_type = 'blacklist'`,
      [value],
    )
    .catch(() => {});
}

/**
 * Check if a URL or its domain/IP is blocked by access rules.
 * Returns allowed: false if the URL matches an active blacklist rule.
 *
 * Matching logic:
 * - If rule is "example.com", it blocks:
 *   - example.com (exact)
 *   - sub.example.com (subdomain)
 *   - example.com/any/path (any path)
 *   - sub.example.com/any/path (subdomain with path)
 */
export async function checkAccessRules(
  url: string,
): Promise<AccessRuleCheckResult> {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const cached = readRuleCache(hostname);
    if (cached) {
      if (
        !cached.allowed &&
        cached.ruleType === "blacklist" &&
        cached.matchedValue
      ) {
        recordBlacklistHit(cached.matchedValue);
      }
      return cached;
    }

    // Extract potential IP address
    const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    const ipAddress = ipMatch ? hostname : null;

    // Escape LIKE metacharacters in the hostname before using it as the
    // right-hand pattern in LOWER($1) LIKE '%. || value'. The hostname
    // itself is on the VALUE side (left) so % and _ are literal there, but
    // value (admin-entered rule) could contain them accidentally. Escaping
    // the admin-supplied rule value is done at write time (admin panel).
    // The hostname we're testing against is our own parsed URL — safe to use as-is.
    const queryParams: string[] = [hostname];
    let ipCondition = "false"; // Default: no IP match possible

    if (ipAddress) {
      queryParams.push(ipAddress);
      // The admin UI accepts CIDR ranges (e.g. "192.168.1.0/24") as well as
      // plain IPs, but exact string equality never matches a CIDR rule
      // against an actual target IP -- every CIDR rule was silently inert.
      // Postgres's inet <<= operator handles both: casting a bare IP to
      // inet treats it as a /32, so this covers exact-IP rules too.
      ipCondition = `(value_type = 'ip' AND $2::inet <<= value::inet)`;
    }

    // scanner: blacklist still wins. If any active blacklist rule
    // matches, the URL is blocked regardless of any whitelist.
    const blacklistResult = await pool.query(
      `
      SELECT value, value_type, reason
      FROM access_rules
      WHERE rule_type = 'blacklist'
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (
          (value_type = 'url' AND (
            LOWER($1) = LOWER(value)
            OR LOWER($1) LIKE '%.' || LOWER(value)
          ))
          OR ${ipCondition}
        )
      LIMIT 1
    `,
      queryParams,
    );

    if (blacklistResult.rows.length > 0) {
      const rule = blacklistResult.rows[0];
      recordBlacklistHit(rule.value);
      const blocked: AccessRuleCheckResult = {
        allowed: false,
        reason:
          rule.reason ||
          `This ${rule.value_type === "ip" ? "IP address" : "URL/domain"} has been blocked.`,
        ruleType: "blacklist",
        matchedValue: rule.value,
      };
      writeRuleCache(hostname, blocked);
      return blocked;
    }

    // scanner: if any active whitelist rules exist, the URL must
    // match at least one. Whitelist is a strict allowlist — operators
    // use it to lock the scanner down to a curated set of targets
    // (internal penetration testing, compliance scans). When no
    // whitelist rules are active, behaviour falls through to "allow".
    const whitelistCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM access_rules
       WHERE rule_type = 'whitelist' AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
    );
    const hasWhitelist = Number(whitelistCount.rows[0]?.count ?? 0) > 0;

    if (hasWhitelist) {
      const whitelistResult = await pool.query(
        `SELECT value, value_type, reason
         FROM access_rules
         WHERE rule_type = 'whitelist'
           AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
           AND (
             (value_type = 'url' AND (
               LOWER($1) = LOWER(value)
               OR LOWER($1) LIKE '%.' || LOWER(value)
             ))
             OR ${ipCondition}
           )
         LIMIT 1`,
        queryParams,
      );
      if (whitelistResult.rows.length === 0) {
        const notListed: AccessRuleCheckResult = {
          allowed: false,
          reason: "Target is not on the active whitelist.",
          ruleType: "whitelist",
        };
        writeRuleCache(hostname, notListed);
        return notListed;
      }
    }

    const allowed: AccessRuleCheckResult = { allowed: true };
    writeRuleCache(hostname, allowed);
    return allowed;
  } catch (error) {
    // scanner: fail-CLOSED on DB error. A DB outage used to silently
    // allow every scan through, turning the outage into a blacklist
    // bypass. Now we refuse the scan. The SSRF guard via
    // validateScanTarget still runs, so private-IP targets remain
    // blocked regardless. Deliberately NOT written to the memo above: a
    // transient outage must stop blocking as soon as the DB is back, not a
    // TTL later.
    console.error(
      `[${APP_NAME}] Access rules check failed (failing closed):`,
      error instanceof Error ? error.message : error,
    );
    return {
      allowed: false,
      reason:
        "Access rules temporarily unavailable; scans are blocked until the issue is resolved.",
      ruleType: "blacklist",
    };
  }
}

/**
 * Check multiple URLs against access rules.
 * Returns the first blocked URL if any, otherwise allowed: true.
 */
export async function checkAccessRulesMultiple(
  urls: string[],
): Promise<AccessRuleCheckResult & { blockedUrl?: string }> {
  for (const url of urls) {
    const result = await checkAccessRules(url);
    if (!result.allowed) {
      return { ...result, blockedUrl: url };
    }
  }
  return { allowed: true };
}
