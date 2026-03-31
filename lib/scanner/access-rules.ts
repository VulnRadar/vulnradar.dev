import pool from "@/lib/database/db"

export interface AccessRuleCheckResult {
  allowed: boolean
  reason?: string
  ruleType?: "blacklist" | "whitelist"
  matchedValue?: string
}

/**
 * Check if a URL or its domain/IP is blocked by access rules.
 * Returns allowed: false if the URL matches an active blacklist rule.
 */
export async function checkAccessRules(url: string): Promise<AccessRuleCheckResult> {
  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname.toLowerCase()
    const fullUrl = url.toLowerCase()
    
    // Extract potential IP address
    const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/)
    const ipAddress = ipMatch ? hostname : null

    // Query for active blacklist rules that match this URL or domain
    const result = await pool.query(`
      SELECT value, value_type, reason
      FROM access_rules
      WHERE rule_type = 'blacklist'
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (
          -- Exact URL match
          (value_type = 'url' AND LOWER(value) = $1)
          -- Domain match (hostname equals or ends with .domain)
          OR (value_type = 'url' AND (
            LOWER($2) = LOWER(value)
            OR LOWER($2) LIKE '%.' || LOWER(value)
          ))
          -- IP match
          OR (value_type = 'ip' AND $3 IS NOT NULL AND LOWER(value) = LOWER($3))
        )
      LIMIT 1
    `, [fullUrl, hostname, ipAddress])

    if (result.rows.length > 0) {
      const rule = result.rows[0]
      
      // Increment hit count (non-blocking)
      pool.query(`
        UPDATE access_rules 
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE value = $1 AND rule_type = 'blacklist'
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
