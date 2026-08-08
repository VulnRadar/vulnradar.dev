/**
 * Read-only lookup of the `subdomain_cache` table (see instrumentation.ts
 * and the write side in app/api/v3/scan/discover/route.ts) for surfaces
 * that may only ever display a previously-cached discovery result and must
 * never trigger a new discovery job themselves -- currently just the
 * anonymous/shared scan view (app/shared/[token]/page.tsx), which has no
 * session or API key to authenticate a POST /api/v3/scan/discover with.
 *
 * Deliberately separate from the discover route's own cache helpers: this
 * module only ever reads, never writes, and callers here don't get to pick
 * forceRefresh.
 */

import pool from "@/lib/database/db";
import { extractRootDomain } from "./root-domain";

/** Matches the discover route's own cache TTL -- both read the same table. */
export const SUBDOMAIN_CACHE_TTL_HOURS = 4;

export interface CachedSubdomainEntry {
  subdomain: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  sources: string[];
}

export interface SubdomainCacheSnapshot {
  domain: string;
  total: number;
  reachable: number;
  subdomains: CachedSubdomainEntry[];
  cached: true;
  cachedAt: string;
  expiresAt: string;
}

/**
 * Returns the unexpired subdomain_cache row for the root domain of
 * `urlOrHost`, or null if there isn't one (never discovered, or the 4-hour
 * cache window has passed). Never performs discovery and never writes.
 */
export async function getCachedSubdomainSnapshot(
  urlOrHost: string,
): Promise<SubdomainCacheSnapshot | null> {
  let hostname: string;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrHost);
    hostname = new URL(hasScheme ? urlOrHost : `https://${urlOrHost}`).hostname;
  } catch {
    return null;
  }
  const domain = extractRootDomain(hostname.toLowerCase());

  try {
    const result = await pool.query(
      `SELECT subdomains, cached_at,
              cached_at + ($2 * INTERVAL '1 hour') as expires_at
       FROM subdomain_cache
       WHERE domain = $1 AND cached_at > NOW() - ($2 * INTERVAL '1 hour')`,
      [domain, SUBDOMAIN_CACHE_TTL_HOURS],
    );
    const row = result.rows[0];
    if (!row?.subdomains) return null;

    const subdomains = row.subdomains as CachedSubdomainEntry[];
    return {
      domain,
      total: subdomains.length,
      reachable: subdomains.filter((s) => s.reachable).length,
      subdomains,
      cached: true,
      cachedAt: row.cached_at,
      expiresAt: row.expires_at,
    };
  } catch (err) {
    console.error(
      "[SubdomainCache] getCachedSubdomainSnapshot error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
