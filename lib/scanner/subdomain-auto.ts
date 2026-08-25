// ════════════════════════════════════════════════════════════════════════════
// AUTOMATIC IN-SCAN SUBDOMAIN DISCOVERY
//
// Runs subdomain discovery as part of every ordinary web scan so the result
// surfaces render the subdomain panel automatically -- exactly the way the
// full DNS record set (lib/scanner/dns-records.ts) and SSL grade
// (lib/scanner/ssl-grade.ts) already auto-populate -- instead of the user
// having to press "Discover subdomains".
//
// This is deliberately best-effort and time-bounded so it can never fail,
// stall, or slow a scan beyond a hard cap:
//
//   1. Cache hit (the common repeat case): the per-domain subdomain_cache is
//      read read-only via getCachedSubdomainSnapshot and recorded instantly,
//      with zero external work.
//   2. Cache miss: the shared discovery engine runs, bounded by
//      DEFAULT_AUTO_TIMEOUT_MS. If it does not finish in time, the scan
//      completes normally with no panel -- but the engine keeps running in
//      the background and warms the DB cache, so the NEXT scan of that domain
//      is an instant cache hit.
//
// It reuses the SAME engine and SAME per-domain cache as the manual
// POST /api/v3/scan/discover route, so nothing external is hit twice and no
// new rate-limit surface is opened. It only ever runs inside executeScan /
// executeCrawlScan, both of which are already gated to an authenticated
// user, so this is not newly exposed to anonymous callers.
//
// The captured result is left in a per-host side channel (mirroring
// dns-records.ts): executeScan / executeCrawlScan read it back by hostname
// when they assemble result_meta. Reads peek (don't delete) so concurrent
// readers each see the value; entries are pruned by TTL on write.
// ════════════════════════════════════════════════════════════════════════════

import { validateScanTarget } from "./safe-fetch";
import { extractRootDomain } from "./root-domain";
import { getCachedSubdomainSnapshot } from "./subdomain-cache";
import { discoverSubdomainsForRoot } from "./subdomain-discovery-engine";
import type { DiscoveryResult } from "./subdomain-types";

export type { DiscoveryResult } from "./subdomain-types";

/**
 * Hard cap on how long a scan will wait for a fresh (cache-miss) discovery.
 * Aligned to the scan's own async-check ceiling (executeScan runs this
 * concurrently with runAsyncChecksDetailed, which already races ~15s), so the
 * first scan of a fresh domain can actually capture the passive sources -- most
 * of the unreachable/CT-log subdomains come from crt.sh, whose own request
 * timeout is 15s. A 10s cap here would always cut crt.sh off, so the first scan
 * would surface nothing and only the background cache-warm made the *next* scan
 * complete. Since discovery overlaps the async checks, this rarely adds
 * wall-clock beyond what the scan already spends.
 */
const DEFAULT_AUTO_TIMEOUT_MS = 15_000;

/** True for a bare IPv4 or IPv6 literal, which has no registrable domain to enumerate. */
function isIpLiteral(host: string): boolean {
  if (host.includes(":")) return true; // IPv6
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Run subdomain discovery for `url` best-effort and record the result in the
 * side channel. Never throws and never rejects: any failure (bad URL, SSRF
 * block, timeout, engine error) simply leaves nothing recorded, so the scan
 * proceeds with no subdomain panel. Only records when at least one subdomain
 * was found, so an empty discovery leaves the owner's manual "Discover"
 * button as the fallback rather than an empty panel.
 */
export async function autoDiscoverSubdomains(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; cacheOnly?: boolean } = {},
): Promise<void> {
  try {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }
    // No registrable domain to enumerate: raw IPs and single-label hosts.
    if (!hostname || !hostname.includes(".") || isIpLiteral(hostname)) return;

    // 1) Cache hit: instant, read-only, no external work.
    const cached = await getCachedSubdomainSnapshot(url);
    if (cached && cached.subdomains.length > 0) {
      recordSubdomains(hostname, cached);
      return;
    }

    // cacheOnly (e.g. the anonymous demo scan): never run the live engine.
    // The passive-source + DNS-brute-force sweep must not be reachable by an
    // unauthenticated caller against an arbitrary domain -- that would let the
    // shared server IP be used for outbound enumeration/amplification. A demo
    // simply shows nothing when the domain isn't already cached.
    if (opts.cacheOnly) return;

    // 2) Cache miss: SSRF-guard the target before any external sweep, exactly
    //    as the manual route does.
    const safety = await validateScanTarget(url);
    if (!safety.safe) return;

    const rootDomain = extractRootDomain(hostname);

    // The engine keeps running (and warms the DB cache) even after we stop
    // awaiting it on timeout, so a slow first scan still makes the next scan
    // of this domain an instant cache hit.
    const enginePromise = discoverSubdomainsForRoot(rootDomain);
    enginePromise.catch(() => {}); // never surface a late rejection

    const timeoutMs = opts.timeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS;
    const result = await Promise.race<DiscoveryResult | null>([
      enginePromise.catch(() => null),
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        opts.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve(null);
          },
          { once: true },
        );
      }),
    ]);

    if (result && result.subdomains.length > 0) {
      recordSubdomains(hostname, result);
    }
  } catch {
    // Best-effort: automatic discovery must never affect the scan.
  }
}

// ─── Per-host side channel (mirrors dns-records.ts) ────────────────────────

const SUBDOMAINS_TTL_MS = 5 * 60 * 1000;
const subdomainsStore = new Map<
  string,
  { result: DiscoveryResult; at: number }
>();

function pruneSubdomainsStore(now: number): void {
  for (const [key, entry] of subdomainsStore) {
    if (now - entry.at > SUBDOMAINS_TTL_MS) subdomainsStore.delete(key);
  }
}

/** Stash a freshly captured discovery result for `hostname`. */
export function recordSubdomains(
  hostname: string,
  result: DiscoveryResult,
): void {
  const now = Date.now();
  pruneSubdomainsStore(now);
  subdomainsStore.set(hostname.toLowerCase(), { result, at: now });
}

/** Read back the result recorded for `hostname`, or undefined if none/stale. */
export function readSubdomains(hostname: string): DiscoveryResult | undefined {
  const entry = subdomainsStore.get(hostname.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > SUBDOMAINS_TTL_MS) {
    subdomainsStore.delete(hostname.toLowerCase());
    return undefined;
  }
  return entry.result;
}
