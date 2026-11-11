import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
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
 * Short-lived per-target memo of a completed rule evaluation.
 *
 * checkAccessRules always cost two serialized round trips (a blacklist
 * SELECT, then a whitelist COUNT), and neither predicate is sargable: the
 * url branch builds its LIKE pattern out of the column, and the ip branch
 * returns every active ip rule. So both are sequential scans of
 * `access_rules`, on a table an admin edits maybe once a month. It runs once
 * per scan, once per URL in a bulk request, and once per selected page
 * before a crawl starts:
 * a 250-page crawl of ONE host paid 500 sequential scans to answer the same
 * question 250 times.
 *
 * The evaluation depends on the hostname and the addresses it resolves to
 * (the ip rules are matched against those), so the decision is memoized per
 * (hostname, addresses). Keying on the name alone would let a host that has
 * just been re-pointed into a blocked range keep its old "allowed" for the
 * whole TTL. The TTL is deliberately short: a newly added blocklist rule
 * takes effect within it without any invalidation hook in the admin write
 * path.
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

function readRuleCache(key: string): AccessRuleCheckResult | null {
  const hit = ruleCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt >= RULE_CACHE_TTL_MS) {
    ruleCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeRuleCache(key: string, result: AccessRuleCheckResult): void {
  // Map iterates in insertion order, so the first key is the oldest entry.
  // Bulk scans can touch many distinct hosts; this keeps the memo bounded.
  if (ruleCache.size >= RULE_CACHE_MAX_ENTRIES) {
    const oldest = ruleCache.keys().next().value;
    if (oldest !== undefined) ruleCache.delete(oldest);
  }
  ruleCache.set(key, { result, cachedAt: Date.now() });
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

export interface AccessRuleCheckOptions {
  /**
   * The addresses the caller already resolved the target to (for example
   * validateScanTarget's resolvedIp, the one the scan will connect to). When
   * given, these are what the ip rules are matched against and DNS is not
   * asked again; when omitted, the hostname is resolved here.
   */
  resolvedAddresses?: readonly string[];
}

const RESOLVE_TIMEOUT_MS = 5_000;

/**
 * Every address `hostname` resolves to, or none. A lookup that fails leaves
 * the target with only its url rules, which is safe: a name that does not
 * resolve cannot be connected to either, and every scan path refuses it at
 * validateScanTarget for that reason.
 */
async function resolveAll(hostname: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("lookup timed out")),
          RESOLVE_TIMEOUT_MS,
        );
      }),
    ]);
    return answers.map((a) => a.address);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Whether an ip rule's value (an address, or a CIDR range) covers any of
 * `addresses`.
 *
 * Matched here rather than with `value::inet` in the query: that cast raises
 * on a value that is not an address, the admin form does not validate the
 * value, and an error fails the whole check closed. Once ip rules apply to
 * every hostname, one mistyped rule would have refused every scan on the
 * deployment. A value that does not parse matches nothing instead.
 */
function ipRuleCovers(value: string, addresses: readonly string[]): boolean {
  const parts = value.trim().split("/");
  if (parts.length > 2) return false;
  const [base, prefixText] = parts;
  const family = isIP(base);
  if (family === 0) return false;
  const type = family === 6 ? "ipv6" : "ipv4";
  const rule = new BlockList();
  if (prefixText === undefined) {
    rule.addAddress(base, type);
  } else {
    if (!/^[0-9]{1,3}$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    if (prefix > (family === 6 ? 128 : 32)) return false;
    rule.addSubnet(base, prefix, type);
  }
  return addresses.some((address) => {
    const f = isIP(address);
    return f !== 0 && rule.check(address, f === 6 ? "ipv6" : "ipv4");
  });
}

/** The first row that matches: url rows were matched by the query itself,
 *  ip rows are every active one and are matched here. */
function firstMatchingRule<T extends { value: string; value_type: string }>(
  rows: readonly T[],
  addresses: readonly string[],
): T | undefined {
  return (
    rows.find((r) => r.value_type === "url") ??
    rows.find(
      (r) => r.value_type === "ip" && ipRuleCovers(String(r.value), addresses),
    )
  );
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
 * - An ip rule (an address or a CIDR range) blocks a target whose host is
 *   that address, or resolves to it. It used to match only a target typed as
 *   an IP literal, so every hostname pointed into a blocked range was scanned
 *   freely and the operator believed the range was protected
 *   (gap-domain-verification-active-gating-2).
 */
export async function checkAccessRules(
  url: string,
  options: AccessRuleCheckOptions = {},
): Promise<AccessRuleCheckResult> {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    // WHATWG URL already normalized decimal/octal/hex IPv4 to dotted form and
    // wrapped IPv6 in brackets, so a literal is recognized here without any
    // un-obfuscating of our own.
    const bare = hostname.replace(/^\[|\]$/g, "");
    const addresses =
      isIP(bare) !== 0
        ? [bare]
        : options.resolvedAddresses
          ? options.resolvedAddresses.filter((a) => isIP(a) !== 0)
          : await resolveAll(hostname);
    const cacheKey = `${hostname}|${[...new Set(addresses)].sort().join(",")}`;

    const cached = readRuleCache(cacheKey);
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

    // Escape LIKE metacharacters in the hostname before using it as the
    // right-hand pattern in LOWER($1) LIKE '%. || value'. The hostname
    // itself is on the VALUE side (left) so % and _ are literal there, but
    // value (admin-entered rule) could contain them accidentally. Escaping
    // the admin-supplied rule value is done at write time (admin panel).
    // The hostname we're testing against is our own parsed URL — safe to use as-is.
    const queryParams: string[] = [hostname];
    // With an address to test, every active ip rule comes back and
    // ipRuleCovers decides. The admin UI accepts CIDR ranges (e.g.
    // "192.168.1.0/24") as well as plain IPs, and both are matched there.
    const ipCondition = addresses.length > 0 ? "value_type = 'ip'" : "false";

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
      ORDER BY (value_type = 'url') DESC
    `,
      queryParams,
    );

    const rule = firstMatchingRule(blacklistResult.rows, addresses);
    if (rule) {
      recordBlacklistHit(rule.value);
      const blocked: AccessRuleCheckResult = {
        allowed: false,
        reason:
          rule.reason ||
          `This ${rule.value_type === "ip" ? "IP address" : "URL/domain"} has been blocked.`,
        ruleType: "blacklist",
        matchedValue: rule.value,
      };
      writeRuleCache(cacheKey, blocked);
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
         ORDER BY (value_type = 'url') DESC`,
        queryParams,
      );
      if (!firstMatchingRule(whitelistResult.rows, addresses)) {
        const notListed: AccessRuleCheckResult = {
          allowed: false,
          reason: "Target is not on the active whitelist.",
          ruleType: "whitelist",
        };
        writeRuleCache(cacheKey, notListed);
        return notListed;
      }
    }

    const allowed: AccessRuleCheckResult = { allowed: true };
    writeRuleCache(cacheKey, allowed);
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
