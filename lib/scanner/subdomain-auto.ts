// ════════════════════════════════════════════════════════════════════════════
// AUTOMATIC IN-SCAN SUBDOMAIN DISCOVERY
//
// Runs subdomain discovery as part of every ordinary web scan so the result
// surfaces render the subdomain panel automatically -- exactly the way the
// full DNS record set (lib/scanner/dns-records.ts) and SSL grade
// (lib/scanner/ssl-grade.ts) already auto-populate -- instead of the user
// having to press "Discover subdomains".
//
// This is deliberately best-effort and OFF the scan's critical path, so it
// can never fail, stall, or slow a scan:
//
//   1. Cache hit (the common repeat case): the per-domain subdomain_cache is
//      read read-only via getCachedSubdomainSnapshot and recorded instantly,
//      with zero external work. This is the only phase a scan waits for.
//   2. Cache miss: the shared discovery engine is kicked off and NOT awaited
//      (see DEFAULT_AUTO_TIMEOUT_MS). The scan completes normally with no
//      panel while the engine keeps running in the background and warms the
//      DB cache, so the NEXT scan of that domain is an instant cache hit.
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
 * How long a scan waits for a fresh (cache-miss) discovery. Zero: it does not
 * wait at all.
 *
 * This used to be a 15s cap that the scan awaited before assembling
 * result_meta, on the reasoning that discovery overlaps the async checks and
 * so costs no extra wall clock. That reasoning was wrong in the case that
 * matters. A cache miss runs four sequential stages (nine passive sources, of
 * which crt.sh alone allows itself 15s, a 191-prefix DNS brute force, DNS
 * resolution of up to 1000 passive names, then HTTP reachability probing of
 * every host), so it cannot finish inside any cap short enough to keep a scan
 * fast: on a miss it reliably burned the whole 15s, and since the wait happens
 * after the fetch, every first scan of a domain took 15-20s instead of 2-5s.
 * Nothing on screen needs it either -- components/scanner/subdomain-discovery.tsx
 * renders from a null snapshot and offers a "Discover subdomains" button.
 *
 * The sweep still runs; it is simply not on the scan's critical path any more.
 * It warms both the per-domain DB cache (subdomain-discovery-engine.ts) and
 * this module's side channel, so the NEXT scan of that domain is an instant
 * cache hit that does render the panel. A caller that genuinely wants to block
 * on a fresh sweep passes an explicit `timeoutMs`.
 * ref: AUDIT-011#scan-01
 */
const DEFAULT_AUTO_TIMEOUT_MS = 0;

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
 *
 * Resolving does NOT mean discovery finished. By default it resolves as soon
 * as the cache lookup settles and leaves any fresh sweep running in the
 * background; pass `timeoutMs` to actually wait for one.
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
    //
    // The hit is decided by "a fresh cache row exists", NOT by "the row has
    // subdomains in it". Gating on a non-empty array meant a domain that
    // genuinely has no discoverable subdomains -- the normal case for a
    // personal site or a single-host deployment -- read as a miss on every
    // single scan and re-ran the full sweep forever, never once benefiting
    // from the cache it had just written. An empty row is a real answer.
    // Nothing is recorded for it, so the panel stays hidden and the owner
    // keeps the manual "Discover" button. ref: AUDIT-011#scan-02
    const cached = await getCachedSubdomainSnapshot(url);
    if (cached) {
      if (cached.subdomains.length > 0) recordSubdomains(hostname, cached);
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

    // The engine keeps running (and warms the DB cache) whether or not anyone
    // is still awaiting it, so a slow first scan still makes the next scan of
    // this domain an instant cache hit. Recording is attached to the engine
    // promise itself rather than to the race below, so a result that lands
    // after we stopped waiting still populates the side channel (5 min TTL)
    // for whatever reads it next in this process.
    const enginePromise = discoverSubdomainsForRoot(rootDomain);
    const recorded = enginePromise
      .then((result) => {
        if (result && result.subdomains.length > 0) {
          recordSubdomains(hostname, result);
        }
        return result;
      })
      .catch(() => null); // never surface a late rejection

    const timeoutMs = opts.timeoutMs ?? DEFAULT_AUTO_TIMEOUT_MS;
    // Default: return now and let the sweep finish in the background. See
    // DEFAULT_AUTO_TIMEOUT_MS for why waiting was the wrong trade.
    if (timeoutMs <= 0) return;

    await Promise.race<DiscoveryResult | null>([
      recorded,
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
