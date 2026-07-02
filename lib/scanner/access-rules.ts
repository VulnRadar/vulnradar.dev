import pool from "@/lib/database/db";

export interface AccessRuleCheckResult {
  allowed: boolean;
  reason?: string;
  ruleType?: "blacklist" | "whitelist";
  matchedValue?: string;
}

// (normalizeDomain removed in cleanup; access-rules.ts now uses external normalization)

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
      ipCondition = `(value_type = 'ip' AND LOWER(value) = LOWER($2))`;
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
      pool
        .query(
          `UPDATE access_rules
           SET hit_count = hit_count + 1, last_hit_at = NOW()
           WHERE LOWER(value) = LOWER($1) AND rule_type = 'blacklist'`,
          [rule.value],
        )
        .catch(() => {});
      return {
        allowed: false,
        reason:
          rule.reason ||
          `This ${rule.value_type === "ip" ? "IP address" : "URL/domain"} has been blocked.`,
        ruleType: "blacklist",
        matchedValue: rule.value,
      };
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
        return {
          allowed: false,
          reason: "Target is not on the active whitelist.",
          ruleType: "whitelist",
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    // scanner: fail-CLOSED on DB error. A DB outage used to silently
    // allow every scan through, turning the outage into a blacklist
    // bypass. Now we refuse the scan. The SSRF guard via
    // validateScanTarget still runs, so private-IP targets remain
    // blocked regardless.
    console.error(
      "[VulnRadar] Access rules check failed (failing closed):",
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
