/**
 * Shared subdomain-discovery result shapes.
 *
 * Extracted here (out of the client component
 * components/scanner/subdomain-discovery.tsx, which still re-exports
 * DiscoveryResult for its existing importers) so both the server-side
 * discovery engine (lib/scanner/subdomain-discovery-engine.ts) and the scan
 * result type (lib/scanner/types.ts) can reference the same shape without a
 * client component being pulled into a server module's import graph. This
 * file has no runtime imports on purpose -- it is types only.
 */

/** A single discovered subdomain plus its reachability and attribution. */
export interface DiscoveredSubdomain {
  subdomain: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  sources: string[];
}

/**
 * The full discovery result for one registrable domain: the flat list of
 * discovered subdomains plus roll-up counts, per-source tallies, and (when
 * served from cache) the cache timestamps. Shared verbatim between the
 * manual POST /api/v3/scan/discover response, the auto-capture side channel,
 * and every result surface that renders the subdomain panel.
 */
export interface DiscoveryResult {
  domain: string;
  total: number;
  reachable: number;
  subdomains: DiscoveredSubdomain[];
  sources?: Record<string, number>;
  cached?: boolean;
  cachedAt?: string;
  expiresAt?: string;
}
