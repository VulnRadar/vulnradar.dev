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

    // Query for active blacklist rules that match this URL or domain
    // For domain matching: if rule is "example.com", match:
    // - hostname = "example.com" (exact match)
    // - hostname ends with ".example.com" (subdomain match)
    // Build query based on whether we have an IP to check
    const queryParams: string[] = [hostname];
    let ipCondition = "false"; // Default: no IP match possible

    if (ipAddress) {
      queryParams.push(ipAddress);
      ipCondition = `(value_type = 'ip' AND LOWER(value) = LOWER($2))`;
    }

    const result = await pool.query(
      `
      SELECT value, value_type, reason
      FROM access_rules
      WHERE rule_type = 'blacklist'
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (
          -- Domain match: exact domain or subdomain
          (value_type = 'url' AND (
            LOWER($1) = LOWER(value)
            OR LOWER($1) LIKE '%.' || LOWER(value)
          ))
          -- IP match
          OR ${ipCondition}
        )
      LIMIT 1
    `,
      queryParams,
    );

    if (result.rows.length > 0) {
      const rule = result.rows[0];

      // Increment hit count (non-blocking)
      pool
        .query(
          `
        UPDATE access_rules 
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE LOWER(value) = LOWER($1) AND rule_type = 'blacklist'
      `,
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
