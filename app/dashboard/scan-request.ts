/**
 * Which scan endpoint a dashboard submission goes to, and what body it sends.
 *
 * Extracted from app/dashboard/page.tsx so the routing decision can be
 * asserted without mounting the whole page, the same reason poll-scan-status.ts
 * lives beside it. The decision matters: it used to send ANY request carrying a
 * login to the single-page endpoint, so asking for a crawl and supplying
 * credentials silently produced a one-page scan with nothing on screen to say
 * the crawl had been dropped (AUDIT-011#drift-21).
 *
 * The rule is: a crawl is a crawl, with or without a login. POST
 * /api/v3/scan/crawl accepts the same `auth` block as the single-page route and
 * threads the session through every page it fetches, so only a SINGLE-page
 * authenticated scan uses the ephemeral endpoint.
 */
import { API } from "@/lib/config/client-constants";
import type { EphemeralAuthInput } from "@/lib/scanner/auth/types";

export interface ScanRequestInput {
  /** Target, as typed (bare domain or full URL: the routes normalize it). */
  url: string;
  /** Pages picked in the crawl selector. Present only for a crawl. */
  crawlUrls?: string[];
  /** Check families / active probes the user picked, if narrowed. */
  scanners?: string[];
  /** Ephemeral login material. Never persisted anywhere by any of the three
   *  endpoints; see lib/scanner/auth/types.ts. */
  auth?: EphemeralAuthInput;
  /** Omitted entirely when the caller made no choice, so the API falls back
   *  to the account's own "scans are private by default" setting rather than
   *  defaulting to public. See lib/scanner/scan-privacy.ts. */
  isPublic?: boolean;
  captureScreenshot?: boolean;
  portScan?: boolean;
}

export interface ScanRequest {
  endpoint: string;
  payload: Record<string, unknown>;
  /**
   * True only for the one request shape that resolves synchronously: the
   * ephemeral single-page authenticated scan returns the finished result
   * rather than a job id. Everything else, crawls included, has to be polled
   * from /api/v3/scan/status/[id].
   */
  isInlineAuthScan: boolean;
}

export function buildScanRequest(input: ScanRequestInput): ScanRequest {
  const {
    url,
    crawlUrls,
    scanners,
    auth,
    isPublic,
    captureScreenshot,
    portScan,
  } = input;
  const isCrawl = !!crawlUrls;
  const isInlineAuthScan = !!auth && !isCrawl;
  const scannerPayload = scanners && scanners.length > 0 ? scanners : undefined;

  const endpoint = isCrawl
    ? API.SCAN_CRAWL
    : auth
      ? API.SCAN_AUTHENTICATED
      : API.SCAN;

  const payload: Record<string, unknown> = isInlineAuthScan
    ? {
        url,
        ...(scannerPayload ? { scanners: scannerPayload } : {}),
        auth,
        ...(typeof isPublic === "boolean" ? { isPublic } : {}),
      }
    : {
        ...(isCrawl ? { url, urls: crawlUrls } : { url }),
        ...(scannerPayload ? { scanners: scannerPayload } : {}),
        ...(typeof isPublic === "boolean" ? { isPublic } : {}),
        // Only a crawl can carry a login here; a signed-out single-page scan
        // goes to POST /api/v3/scan, which has no auth block.
        ...(isCrawl && auth ? { auth } : {}),
        // Opt-in extras: only sent when true, so an ordinary scan never even
        // mentions them. Neither applies to the single-page authenticated
        // endpoint, whose schema does not take them.
        ...(captureScreenshot ? { captureScreenshot: true } : {}),
        ...(portScan ? { portScan: true } : {}),
      };

  return { endpoint, payload, isInlineAuthScan };
}
