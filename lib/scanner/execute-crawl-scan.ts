/**
 * Crawl scan execution: the background job body for POST
 * /api/v3/scan/crawl.
 *
 * Split out of app/api/v3/scan/crawl/route.ts because a Next.js route file
 * may only export the handful of names Next recognizes (GET, POST, etc.) —
 * anything else fails the route's generated type check. Living here also
 * means the tests exercise the exact function the route dispatches
 * fire-and-forget, instead of racing a detached promise.
 */

import {
  canMakeRequest,
  incrementDailyCount,
} from "@/lib/rate-limiting/daily-limits";
import { runSyncChecks, getPlannedSyncCategories } from "./engine";
import { runAsyncChecks, getPlannedAsyncBranches } from "./async-checks";
import {
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  ScanCancelledError,
} from "./scan-jobs";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  SEVERITY_LEVELS,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import type {
  Vulnerability,
  Severity,
  Category,
  ScanProgressHook,
} from "./types";
import { checkAccessRules } from "./access-rules";
import { safeFetch } from "./safe-fetch";
import { redactSensitiveResponseHeaders } from "./response-headers";
import { enrichFindingsWithExploitIntel } from "./cve-enrichment";
import { checkForNewCriticalOrHighFindings } from "./regression-alert";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { criticalFindingsEmail } from "@/lib/email/email";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
const MAX_BODY_SIZE = 1 * 1024 * 1024;
export const MAX_PAGES = 15; // max pages to crawl
const CRAWL_TIMEOUT = 8000;

async function safeReadBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        const overshoot = totalBytes - maxBytes;
        const trimmed = value.slice(0, value.byteLength - overshoot);
        if (trimmed.byteLength > 0)
          chunks.push(decoder.decode(trimmed, { stream: false }));
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    /* return partial */
  } finally {
    try {
      reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return chunks.join("");
}

/**
 * Crawl a page and extract same-origin internal links.
 * Skips external domains, anchors, mailto, tel, and asset files.
 */
async function discoverInternalLinks(startUrl: string): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const visited = new Set<string>([startUrl]);
  const queue = [startUrl];
  const found: string[] = [startUrl];

  const skipExtensions =
    /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|mjs|cjs|woff2?|ttf|eot|otf|pdf|zip|tar|gz|mp4|mp3|wav|ogg|webm|avif|map|xml|rss|atom|json|wasm|txt)$/i;
  const skipPathSegments =
    /(\/_next\/|\/static\/|\/assets\/|\/api\/|\/favicon|\/robots\.txt|\/sitemap|\/manifest|\/sw\.js|\/workbox)/i;

  function isCleanUrl(href: string): boolean {
    // Skip anything with encoded brackets, regex-like patterns, or non-printable chars
    if (
      /[%\[\]{}|\\^`<>]/.test(href) &&
      /%5[bBdD]|%5[eE]|%7[bBdD]|%3[eE]|%3[cC]/.test(href)
    )
      return false;
    // Skip data URIs
    if (href.startsWith("data:")) return false;
    // Skip fragments-only and empty
    if (!href || href === "#" || href.startsWith("#")) return false;
    // Skip non-HTTP
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:") ||
      href.startsWith("vbscript:")
    )
      return false;
    return true;
  }

  while (queue.length > 0 && found.length < MAX_PAGES) {
    const url = queue.shift()!;
    try {
      // Validate URL to prevent SSRF - check protocol and parse URL
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        continue;
      }

      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        continue;
      }

      // Only allow http and https protocols
      if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
        continue;
      }

      // Must match the origin hostname
      if (urlObj.hostname !== new URL(origin).hostname) {
        continue;
      }

      // Use safeFetch which validates the URL internally to prevent SSRF
      // Pass the entry hostname as the only allowed hostname to prevent redirect-based SSRF
      const res = await safeFetch(
        urlObj.href,
        {
          method: "GET",
          headers: { "User-Agent": `${APP_NAME}/1.0 (Crawler)` },
          redirect: "follow",
          signal: AbortSignal.timeout(CRAWL_TIMEOUT),
        },
        [new URL(origin).hostname],
      );

      // Only allow redirects that stay on the exact same hostname
      const redirectedUrl = new URL(res.url);
      const entryHostname = new URL(origin).hostname;
      if (redirectedUrl.hostname !== entryHostname) continue;

      // Use the actual (post-redirect) URL as the base for resolving relative links
      const actualUrl = res.url;

      // If redirected to a different path on the same host, track it (but avoid duplicating "/")
      const redirectNormalized =
        redirectedUrl.origin + redirectedUrl.pathname + redirectedUrl.search;
      if (!visited.has(redirectNormalized)) {
        visited.add(redirectNormalized);
        if (!found.includes(redirectNormalized)) found.push(redirectNormalized);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const body = await safeReadBody(res, MAX_BODY_SIZE);

      // Extract href values from <a> tags only (not link/script/img tags)
      const anchorRegex = /<a\s[^>]*href=["']([^"'#]+?)["']/gi;
      let match: RegExpExecArray | null;
      while ((match = anchorRegex.exec(body)) !== null) {
        const href = match[1].trim();

        if (!isCleanUrl(href)) continue;
        if (skipExtensions.test(href)) continue;

        // Resolve relative URLs against the actual (post-redirect) URL
        let resolved: URL;
        try {
          resolved = new URL(href, actualUrl);
        } catch {
          continue;
        }

        // Must be exact same hostname (no subdomains)
        if (resolved.hostname !== entryHostname) continue;

        // Skip asset/internal paths
        const fullPath = resolved.pathname + resolved.search;
        if (skipPathSegments.test(fullPath)) continue;
        if (skipExtensions.test(resolved.pathname)) continue;

        // Normalize: remove hash, keep pathname + search
        const normalized =
          resolved.origin + resolved.pathname + resolved.search;

        if (!visited.has(normalized) && found.length < MAX_PAGES) {
          visited.add(normalized);
          found.push(normalized);
          queue.push(normalized);
        }
      }
    } catch {
      // Timeout or network error: skip this page
    }
  }

  return found;
}

async function scanSingleUrl(
  url: string,
  scanners?: string[] | null,
  onProgress?: ScanProgressHook,
): Promise<{
  url: string;
  findings: Vulnerability[];
  checksRun?: number;
  summary: Record<string, number>;
  duration: number;
  responseHeaders: Record<string, string>;
}> {
  const startTime = Date.now();

  let response: Response;
  try {
    // Validate URL to prevent SSRF
    const urlObj = new URL(url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }

    // Use safeFetch which validates the URL internally to prevent SSRF
    // Pass the original hostname as the only allowed hostname to prevent redirect-based SSRF
    response = await safeFetch(
      urlObj.href,
      {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      },
      [urlObj.hostname],
    );
  } catch {
    return {
      url,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      duration: Date.now() - startTime,
      responseHeaders: {},
    };
  }

  const responseBody = await safeReadBody(response, MAX_BODY_SIZE);
  const headers = response.headers;
  const capturedHeaders: Record<string, string> = {};
  headers.forEach((v, k) => {
    capturedHeaders[k] = v;
  });
  // scanner: redact sensitive headers.
  const redactedHeaders = redactSensitiveResponseHeaders(capturedHeaders);

  const bodyForChecks =
    responseBody.length > 1_000_000
      ? responseBody.slice(0, 1_000_000)
      : responseBody;
  const syncResult = runSyncChecks(
    url,
    headers,
    bodyForChecks,
    scanners as Category[] | null,
    onProgress,
  );
  const syncFindings = syncResult.findings;

  let asyncFindings: Vulnerability[] = [];
  try {
    asyncFindings = await Promise.race([
      runAsyncChecks(url, scanners, onProgress),
      new Promise<Vulnerability[]>((resolve) =>
        setTimeout(() => resolve([]), 15000),
      ),
    ]);
  } catch {
    /* non-fatal */
  }

  const findings = [...syncFindings, ...asyncFindings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const summary = {
    critical: findings.filter((f) => f.severity === SEVERITY_LEVELS.CRITICAL)
      .length,
    high: findings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH).length,
    medium: findings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
      .length,
    low: findings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
    info: findings.filter((f) => f.severity === SEVERITY_LEVELS.INFO).length,
    total: findings.length,
  };

  return {
    url,
    findings,
    checksRun: syncResult.checksRun,
    summary,
    duration: Date.now() - startTime,
    responseHeaders: redactedHeaders,
  };
}

export interface ExecuteCrawlScanParams {
  scanId: number;
  normalizedMainUrl: string;
  mainOrigin: string;
  selectedUrls: string[] | undefined;
  scanners: string[] | null;
  authedUserId: number;
  isApiKeyAuth: boolean;
}

/**
 * Discover (or accept pre-selected) pages, scan each one, and persist
 * progress and the final merged result to `scan_history`.
 *
 * Called fire-and-forget from POST /api/v3/scan/crawl, detached from that
 * request's lifecycle — safe here specifically because VulnRadar runs as
 * one persistent Node process, not serverless functions (see
 * lib/scanner/execute-scan.ts for the same reasoning).
 *
 * One deliberate behavior change from the synchronous version: the "main"
 * scan_history row is now created up front, before discovery runs (there
 * has to be something to poll immediately), so it is a dedicated tracker
 * row rather than reusing whichever row happens to belong to the first
 * discovered page. Every discovered page still gets its own child row, as
 * before.
 */
export async function executeCrawlScan(
  params: ExecuteCrawlScanParams,
): Promise<void> {
  const {
    scanId,
    normalizedMainUrl,
    mainOrigin,
    selectedUrls,
    scanners,
    authedUserId,
    isApiKeyAuth,
  } = params;

  const startTime = Date.now();
  const crawlTimeoutSeconds = await getSetting("CRAWL_SCAN_TIMEOUT_SECONDS");
  const watchdog = startWatchdog(
    scanId,
    crawlTimeoutSeconds * 1000,
    `Crawl scan exceeded the ${crawlTimeoutSeconds}s time limit.`,
  );
  const { onProgress, setTotal } = createProgressTracker(scanId);

  try {
    await markScanRunning(scanId);

    // Use pre-selected URLs if provided, otherwise discover them.
    let pages: string[];
    if (selectedUrls && selectedUrls.length > 0) {
      const checkedUrls: string[] = [];
      for (const u of selectedUrls.slice(0, MAX_PAGES)) {
        try {
          const parsed = new URL(u);
          // Restrict to same origin as the main URL to prevent cross-origin abuse
          if (parsed.origin !== mainOrigin) continue;
          const ac = await checkAccessRules(u);
          if (ac.allowed) checkedUrls.push(u);
        } catch {
          // skip malformed URLs
        }
      }
      pages = checkedUrls;
    } else {
      pages = await discoverInternalLinks(normalizedMainUrl);
    }

    if (pages.length === 0) {
      throw new Error(
        "No scannable pages were found for this URL. It may block automated crawling or have no internal links.",
      );
    }

    // Daily quota: each page counts as one scan (API-key auth uses its own
    // per-key limits, already checked at request time in POST).
    const quotaCheck = isApiKeyAuth
      ? {
          allowed: true,
          limit: -1,
          used: 0,
          remaining: pages.length,
          resetsAt: "",
        }
      : await canMakeRequest(authedUserId);
    if (!quotaCheck.allowed) {
      throw new Error(
        "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
      );
    }

    // Cap pages to remaining quota
    const maxPagesToScan =
      quotaCheck.limit === -1
        ? pages.length
        : Math.min(pages.length, quotaCheck.remaining);
    const pagesToScan = pages.slice(0, maxPagesToScan);
    const skippedCount = pages.length - pagesToScan.length;

    // Progress denominator: every page runs the same planned set of
    // categories/branches (crawl pages all share the main URL's origin, so
    // https-ness and the scanners filter are identical for each one).
    const perPageUnits =
      getPlannedSyncCategories(scanners as Category[] | null).length +
      getPlannedAsyncBranches(normalizedMainUrl, scanners).length;
    setTotal(pagesToScan.length * perPageUnits);

    // Scan each page
    const pageResults: Array<{
      url: string;
      findings: Vulnerability[];
      summary: Record<string, number>;
      duration: number;
      responseHeaders: Record<string, string>;
    }> = [];

    for (const pageUrl of pagesToScan) {
      // Increment daily count before each scan (skip for API key auth)
      if (!isApiKeyAuth) {
        await incrementDailyCount(authedUserId);
      }
      const result = await scanSingleUrl(pageUrl, scanners, onProgress);
      pageResults.push(result);
    }

    // Merge all findings, deduplicating by id
    const seenIds = new Set<string>();
    let allFindings: Vulnerability[] = [];
    for (const pr of pageResults) {
      for (const f of pr.findings) {
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          allFindings.push(f);
        }
      }
    }
    allFindings.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );

    // Post-processing enrichment: attach CISA KEV / FIRST.org EPSS
    // exploit-likelihood intel to any finding that names a CVE in its own
    // text. Fail-open (see cve-enrichment.ts) — a network hiccup or a
    // self-hosted instance with no outbound internet never fails the scan,
    // it just means findings come back without this annotation. Applied to
    // the merged array only (what finalizeScanSuccess and host_reputation
    // read); the per-page rows persisted directly to scan_history below
    // keep their unenriched findings.
    allFindings = await enrichFindingsWithExploitIntel(allFindings);

    const totalDuration = Date.now() - startTime;
    const mergedSummary = {
      critical: allFindings.filter(
        (f) => f.severity === SEVERITY_LEVELS.CRITICAL,
      ).length,
      high: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.HIGH)
        .length,
      medium: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
        .length,
      low: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.LOW).length,
      info: allFindings.filter((f) => f.severity === SEVERITY_LEVELS.INFO)
        .length,
      total: allFindings.length,
    };

    // Use first page's response headers as the main headers
    const mainHeaders = pageResults[0]?.responseHeaders || {};
    const scannedAt = new Date().toISOString();

    // Save EACH page as its own history entry (like bulk scan), separate
    // from the tracker row this whole job is reported against.
    const pageHistoryIds: Record<string, number> = {};
    for (const pr of pageResults) {
      try {
        const insertResult = await pool.query(
          `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            authedUserId,
            pr.url,
            JSON.stringify(pr.summary),
            JSON.stringify(pr.findings),
            pr.summary.total,
            pr.duration,
            scannedAt,
            isApiKeyAuth ? "api" : "web",
            JSON.stringify(pr.responseHeaders),
            DEFAULT_SCAN_NOTE,
          ],
        );
        pageHistoryIds[pr.url] = insertResult.rows[0]?.id;
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to save crawl history:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const applied = await finalizeScanSuccess(scanId, {
      summary: mergedSummary,
      findings: allFindings,
      duration: totalDuration,
      scannedAt,
      responseHeaders: mainHeaders,
      resultMeta: {
        crawl: {
          pagesDiscovered: pages.length,
          pagesScanned: pageResults.length,
          pagesSkipped: skippedCount,
          pages: pageResults.map((p) => ({
            url: p.url,
            scanHistoryId: pageHistoryIds[p.url] || null,
            findings: p.findings,
            findings_count: p.summary.total,
            summary: p.summary,
            duration: p.duration,
          })),
        },
      },
    });

    // Row already reached a terminal state (watchdog timeout or
    // cancellation raced this completion) -- don't alert for a result
    // nobody will see. Unlike execute-scan.ts, a crawl scan never sent any
    // notification email at all before this; the only one added here is
    // the critical/high regression alert, gated the same way a single-URL
    // scan's is (lib/scanner/regression-alert.ts): only when the diff
    // against the previous scan of this exact main URL turns up a
    // genuinely new, non-suppressed critical/high finding.
    if (applied) {
      pool
        .query("SELECT email FROM users WHERE id = $1", [authedUserId])
        .then(async ({ rows }) => {
          if (rows.length === 0) return;
          const userEmail = rows[0].email;

          try {
            const regressionCheck = await checkForNewCriticalOrHighFindings({
              userId: authedUserId,
              url: normalizedMainUrl,
              scanId,
              currentFindings: allFindings,
            });
            if (regressionCheck.hasNewCriticalOrHigh) {
              const criticalEmail = criticalFindingsEmail(
                normalizedMainUrl,
                regressionCheck.newFindings,
                regressionCheck.outstandingFindings,
                scanId,
              );
              await sendNotificationEmail({
                userId: authedUserId,
                userEmail,
                type: "severity_alerts",
                emailContent: criticalEmail,
              });
            }
          } catch (error) {
            console.error(
              `[${APP_NAME}] Failed to send critical findings email:`,
              error instanceof Error ? error.message : error,
            );
          }
        })
        .catch((error) => {
          console.error(
            `[${APP_NAME}] Failed to fetch user email for crawl scan notifications:`,
            error instanceof Error ? error.message : error,
          );
        });
    }
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      await finalizeScanFailure(scanId, "Cancelled");
    } else {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during the crawl scan.";
      console.error(`[${APP_NAME}] Background crawl scan failed:`, message);
      await finalizeScanFailure(scanId, message);
    }
  } finally {
    clearTimeout(watchdog);
  }
}
