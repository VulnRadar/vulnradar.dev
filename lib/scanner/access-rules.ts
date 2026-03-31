import pool from "@/lib/database/db"

export interface AccessRuleCheckResult {
  allowed: boolean
  reason?: string
  ruleType?: "blacklist" | "whitelist"
  matchedValue?: string
}

/**
 * Normalize a domain by removing protocol and trailing slashes.
 * Used to ensure consistent matching.
 */
function normalizeDomain(value: string): string {
  let normalized = value.trim().toLowerCase()
  // Remove any protocol (http://, https://, ftp://, sftp://, etc.)
  normalized = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
  // Remove trailing slashes and paths for base domain matching
  normalized = normalized.replace(/\/.*$/, "")
  return normalized
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
export async function checkAccessRules(url: string): Promise<AccessRuleCheckResult> {
  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname.toLowerCase()
    
    // Extract potential IP address
    const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/)
    const ipAddress = ipMatch ? hostname : null

    // Query for active blacklist rules that match this URL or domain
    // For domain matching: if rule is "example.com", match:
    // - hostname = "example.com" (exact match)
    // - hostname ends with ".example.com" (subdomain match)
    const result = await pool.query(`
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
          OR (value_type = 'ip' AND $2 IS NOT NULL AND LOWER(value) = LOWER($2))
        )
      LIMIT 1
    `, [hostname, ipAddress])

    if (result.rows.length > 0) {
      const rule = result.rows[0]
      
      // Increment hit count (non-blocking)
      pool.query(`
        UPDATE access_rules 
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE LOWER(value) = LOWER($1) AND rule_type = 'blacklist'
      `, [rule.value]).catch(() => {})

      return {
        allowed: false,
        reason: rule.reason || `This ${rule.value_type === 'ip' ? 'IP address' : 'URL/domain'} has been blocked.`,
        ruleType: "blacklist",
        matchedValue: rule.value,
      }
    }

    return { allowed: true }
  } catch (error) {
    // On error, allow the scan to proceed (fail-open for availability)
    console.error("[VulnRadar] Access rules check failed:", error instanceof Error ? error.message : error)
    return { allowed: true }
  }
}

/**
 * Check multiple URLs against access rules.
 * Returns the first blocked URL if any, otherwise allowed: true.
 */
export async function checkAccessRulesMultiple(urls: string[]): Promise<AccessRuleCheckResult & { blockedUrl?: string }> {
  for (const url of urls) {
    const result = await checkAccessRules(url)
    if (!result.allowed) {
      return { ...result, blockedUrl: url }
    }
  }
  return { allowed: true }
}
