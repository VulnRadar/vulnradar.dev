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
  incrementDailyCountCapped,
} from "@/lib/rate-limiting/daily-limits";
import {
  PAGE_CHECKS_INCOMPLETE,
  dedupeScanFindings,
  runSyncChecksYielding,
  getPlannedSyncCategories,
} from "./engine";
import {
  runAsyncChecksDetailed,
  getPlannedAsyncBranches,
  type AsyncCheckResult,
} from "./async-checks";
import { readSslGrade } from "./ssl-grade";
import { readThreatIntel } from "./reputation-lookup";
import { readDnsRecords } from "./dns-records";
import { readSubdomains, autoDiscoverSubdomains } from "./subdomain-auto";
import {
  createProgressTracker,
  startWatchdog,
  finalizeScanSuccess,
  finalizeScanFailure,
  markScanRunning,
  ScanCancelledError,
  getCancelSignal,
  clearCancel,
  isCancelled,
  requestSignal,
} from "./scan-jobs";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  SEVERITY_LEVELS,
  SEVERITY_PRIORITY,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { logError } from "@/lib/logging/log";
import { runWithScanId } from "@/lib/database/request-context";
import { mergeFindingsAcrossPages } from "./crawl-merge";
import type { Vulnerability, Category, ScanProgressHook } from "./types";
import type { FailureKind } from "./failure-kinds";
import { checkAccessRules } from "./access-rules";
import { safeFetch } from "./safe-fetch";
import { safeReadBody } from "./read-bounded-body";
import { discoverPages, landedPageUrl } from "./crawl-discovery";
import { insertCrawlPageRows } from "./crawl-page-rows";
import {
  CRAWL_PAGES_CHALLENGED_INCOMPLETE,
  CRAWL_QUOTA_LIMIT_INCOMPLETE,
  CRAWL_TIME_LIMIT_INCOMPLETE,
} from "./crawl-incomplete";
import { BOT_CHALLENGE_INCOMPLETE, detectBotChallenge } from "./bot-challenge";
import { canonicalPageUrl } from "./page-url";
import type { ScanSessionBinding, ScanAuthReport } from "./auth/types";
import { redactSensitiveResponseHeaders } from "./response-headers";
import { enrichFindingsWithExploitIntel } from "./cve-enrichment";
import { applyAdaptiveConfidence } from "./adaptive-confidence";
import { attachCvssScores } from "./cvss";
import { getDangerScore, getEngineConfidence } from "./safety-rating";
import { getSiteGrade } from "./site-grade";
import {
  captureAndStoreScreenshot,
  shouldCaptureScreenshot,
  type ScanScreenshotRef,
} from "./page-screenshot";
import {
  scanPorts,
  buildRiskyPortFindings,
  type PortScanResult,
} from "./port-scan";
import {
  fingerprintSoftware,
  recordSoftwareFingerprint,
  readSoftwareFingerprint,
  correlateSoftwareCves,
} from "./software-inventory";
import { notifyScanComplete } from "@/lib/webhooks/scan-notifications";

/**
 * Pages in flight at once. Deliberately small: a crawl is still a stranger's
 * server being probed, and politeness matters more than wall-clock here. It
 * is only safe at all because the host-level branches (DNS, TLS, reputation,
 * robots/security.txt, the 23 exposed-file probes) no longer run per page,
 * so one page is now its own fetch plus its own page-level checks rather
 * than ~25 requests at the shared origin. ref: AUDIT-012#perf-03
 */
const CRAWL_PAGE_CONCURRENCY = 3;

/**
 * How much of the crawl's watchdog budget the page loop may use before it
 * stops taking new pages, and how much of what is left is kept for everything
 * after the loop (merging, the enrichment passes, the page-row INSERT, the
 * finalize). The watchdog is a hard ceiling that fails the whole crawl, so
 * the loop has to stop short of it: a crawl that hit it used to be marked
 * failed and lose every page it had already scanned, with the quota for each
 * still spent.
 */
const CRAWL_SOFT_DEADLINE_SHARE = 0.85;
const CRAWL_FINALIZE_MARGIN_MS = 30_000;
/** The soft deadline never falls below this share, whatever the margin does to a tiny budget. */
const CRAWL_SOFT_DEADLINE_FLOOR_SHARE = 0.5;

/**
 * Milliseconds after the watchdog is armed at which the page loop stops
 * handing out new pages. Pages already in flight finish, and the crawl
 * finalizes with the ones it has. About 85% of the budget less a finalize
 * margin, floored at half of it so a short budget still scans something.
 */
export function crawlSoftDeadlineMs(budgetMs: number): number {
  return Math.max(
    budgetMs * CRAWL_SOFT_DEADLINE_FLOOR_SHARE,
    budgetMs * CRAWL_SOFT_DEADLINE_SHARE - CRAWL_FINALIZE_MARGIN_MS,
  );
}

/**
 * How far past the async layer's per-branch timeout the outer race on a page
 * must be. The branch timer starts only after a settings read, so an outer
 * ceiling equal to the branch ceiling can fire first and discard branches that
 * had already finished. The two settings are edited independently, so the
 * order is enforced here rather than hoped for.
 */
const ASYNC_OUTER_HEADROOM_MS = 2_000;

export function asyncOuterTimeoutMs(outerMs: number, branchMs: number): number {
  return Math.max(outerMs, branchMs + ASYNC_OUTER_HEADROOM_MS);
}

/** Why a page was not read, as shown beside it in the crawl result. */
const BOT_CHALLENGE_REASON = "Blocked by a bot challenge";
const FETCH_FAILURE_REASONS = new Map([
  ["cross_host_redirect", "Redirected to another host"],
  ["timeout", "Did not answer in time"],
  ["tls", "TLS certificate or handshake failed"],
  ["unreachable", "Could not connect"],
  ["blocked", "Address not allowed"],
]);

/**
 * The sentence for a failed page fetch. safeFetch's errors carry a `code`,
 * on themselves or on their `cause`; a timer that fired is also named by its
 * abort reason. Anything else is "could not be fetched": the page is still
 * listed as unread, just without a more specific reason.
 */
function describeFetchFailure(err: unknown): string {
  if (err && typeof err === "object") {
    const { code, cause, name } = err as {
      code?: unknown;
      cause?: unknown;
      name?: unknown;
    };
    const causeCode =
      cause && typeof cause === "object"
        ? (cause as { code?: unknown }).code
        : undefined;
    for (const candidate of [code, causeCode]) {
      const reason =
        typeof candidate === "string"
          ? FETCH_FAILURE_REASONS.get(candidate)
          : undefined;
      if (reason) return reason;
    }
    if (name === "TimeoutError") return FETCH_FAILURE_REASONS.get("timeout")!;
  }
  return "Could not be fetched";
}

/**
 * A crawl that ended without running, with the reason it did not. Thrown
 * inside the job so the catch can record the right failure kind: a quota
 * refusal or a page list that came to nothing is not the engine breaking, and
 * must not be counted as if it were.
 */
class CrawlRefusal extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
  ) {
    super(message);
    this.name = "CrawlRefusal";
  }
}

async function scanSingleUrl(
  url: string,
  maxBodySize: number,
  /**
   * CRAWL_PAGE_FETCH_TIMEOUT_MS. The setting existed and the registry's help
   * text described it as the per-page fetch timeout, but it only ever reached
   * discoverPages. The fetch that actually SCANS each page, which is the
   * crawl's most expensive network operation, sat on a hardcoded 15000 and had
   * no knob at all.
   */
  fetchTimeoutMs: number,
  /**
   * SCAN_ASYNC_CHECKS_TIMEOUT_MS, for the same reason as the parameter above.
   *
   * The identical race in execute-scan.ts resolves this setting, and its
   * comment records that raising the value "moved three routes and left the
   * fourth on a literal". This was that fourth: the crawl's own getSettings
   * block resolved four keys and omitted this one, so the crawl's async
   * checks sat on a hardcoded 15000 whatever an admin set.
   */
  asyncChecksTimeoutMs: number,
  scanners?: string[] | null,
  onProgress?: ScanProgressHook,
  cancelSignal?: AbortSignal,
  session?: ScanSessionBinding,
): Promise<{
  url: string;
  findings: Vulnerability[];
  checksRun?: number;
  summary: Record<string, number>;
  duration: number;
  responseHeaders: Record<string, string>;
  /**
   * Async branch labels that did not contribute for this page: they timed
   * out, threw, or never ran because the page could not be fetched. Empty
   * means every planned branch reached a conclusion. The caller unions these
   * across pages into the crawl's result_meta.incomplete, exactly as a
   * single-URL scan does (execute-scan.ts), so "no TLS findings" is never
   * shown as "TLS is clean" when the TLS branch simply did not finish.
   */
  incomplete: string[];
  /** Ids of the page checks that threw on this page. */
  erroredChecks?: string[];
  /**
   * Set when nothing ran against this page because it could not be read: the
   * fetch failed, or the site answered with a bot challenge. The value is the
   * reason, in words. Such a page has no findings because it was never
   * looked at, so it gets no scan row of its own (a row would read as a clean
   * completed scan in History) and is listed under
   * result_meta.crawl.pagesUnreachable instead.
   */
  unreachable?: string;
}> {
  const startTime = Date.now();

  // What the async layer would run for this page. Needed up front because the
  // failure paths below have no per-branch report to read: on a fetch failure
  // or the outer ceiling, everything planned is what did not complete.
  //
  // "page" scope only: the host-level branches run once for the whole crawl
  // in executeCrawlScan, not once per page. ref: AUDIT-012#perf-03
  const plannedBranches = getPlannedAsyncBranches(url, scanners, "page");

  let response: Response;
  try {
    // Validate URL to prevent SSRF
    const urlObj = new URL(url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }

    // Use safeFetch which validates the URL internally to prevent SSRF
    // Pass the original hostname as the only allowed hostname to prevent redirect-based SSRF.
    // The session (when present) is attached only to same-origin hops by
    // safeFetch, so an authenticated crawl scans the page as the logged-in
    // user while a redirect off-host still drops the credentials.
    response = await safeFetch(
      urlObj.href,
      {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
        redirect: "follow",
        signal: requestSignal(fetchTimeoutMs, cancelSignal),
      },
      [urlObj.hostname],
      session,
    );
  } catch (err) {
    // The page could not be fetched at all, so nothing ran against it. That
    // is a hole in the crawl, not a clean page: report every planned branch
    // as not completed so the merged result cannot claim coverage it never
    // had. ref: AUDIT-014#state-03
    //
    // Not logged: a target that is down or slow is an outcome the result
    // records (STYLE.md, "Logging"), and a crawl of a flaky site would
    // otherwise write a row to the error log per page.
    return {
      url,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      duration: Date.now() - startTime,
      responseHeaders: {},
      incomplete: plannedBranches,
      unreachable: describeFetchFailure(err),
    };
  }

  const responseBody = await safeReadBody(response, maxBodySize);
  const headers = response.headers;
  const capturedHeaders: Record<string, string> = {};
  headers.forEach((v, k) => {
    capturedHeaders[k] = v;
  });
  // scanner: redact sensitive headers.
  const redactedHeaders = redactSensitiveResponseHeaders(capturedHeaders);

  // A bot challenge where the page should be (lib/scanner/bot-challenge.ts).
  // Every check below would grade the challenge as this page, so none run and
  // the page is reported as not checked, like one that could not be fetched.
  if (detectBotChallenge(response.status, headers, responseBody)) {
    return {
      url,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      duration: Date.now() - startTime,
      responseHeaders: redactedHeaders,
      incomplete: [BOT_CHALLENGE_INCOMPLETE],
      unreachable: BOT_CHALLENGE_REASON,
    };
  }

  // Capped at the SAME resolved setting the body was READ with, rather
  // than at a second hardcoded literal. This used to re-cap at 1,000,000
  // bytes: both settings ship a 1 MiB default and both describe themselves
  // as "bytes read from the response body BEFORE body-based checks run",
  // so the literal was a redundant second ceiling sitting 48 KB under the
  // shipped default and ignoring the setting outright. Raising the setting
  // to 5 MB read 5 MB off the wire and threw 4 MB away before any check
  // saw it.
  const bodyForChecks =
    responseBody.length > maxBodySize
      ? responseBody.slice(0, maxBodySize)
      : responseBody;

  // Software inventory fingerprint (pure, no network): stash this page's
  // detected components into the per-host side channel. Crawl pages all share
  // one host, so these merge; execute-crawl-scan reads the merged set once for
  // the main host and correlates it to CVEs (see lib/scanner/software-inventory.ts).
  try {
    recordSoftwareFingerprint(
      new URL(url).hostname,
      fingerprintSoftware(headers, bodyForChecks, url),
    );
  } catch {
    /* best-effort: a fingerprint hiccup never affects the page scan */
  }

  // Yielding variant: a crawl runs this once per page in the same process
  // that is serving every other scan and status poll, so the per-page
  // synchronous block is exactly what must not be uninterrupted.
  // ref: AUDIT-011#scan-06
  const syncResult = await runSyncChecksYielding(
    url,
    headers,
    bodyForChecks,
    scanners as Category[] | null,
    onProgress,
    // The page this crawl entry actually landed on, when a redirect moved it.
    // Detectors judge the response they are reading; ids stay on the crawled
    // URL (see checkPasses in engine.ts). landedPageUrl, not a string
    // comparison: the same page spelled two ways is not a redirect, and a
    // plain-http fetch that reports the pinned IP is not one either.
    landedPageUrl(url, response.url),
  );
  const syncFindings = syncResult.findings;

  // runAsyncChecksDetailed, not runAsyncChecks: the crawl result is rendered
  // through the same components as a single scan, so it needs the same
  // completeness bookkeeping. The bookkeeping-free variant was what made a
  // deep scan structurally unable to say it came back short.
  let asyncFindings: Vulnerability[] = [];
  let asyncIncomplete: string[] = [];
  let asyncTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const asyncResult = await Promise.race<AsyncCheckResult>([
      runAsyncChecksDetailed(url, scanners, onProgress, cancelSignal, "page"),
      new Promise<AsyncCheckResult>((resolve) => {
        // On the ceiling, resolve to "every planned branch did not complete",
        // never to a bare []. An empty findings array with no marker is
        // indistinguishable from a page whose DNS, TLS and live-fetch checks
        // all ran and found nothing, which is how a timed-out deep scan came
        // back reading as clean. ref: AUDIT-014#state-03
        asyncTimeoutHandle = setTimeout(
          () => resolve({ findings: [], incomplete: plannedBranches }),
          asyncChecksTimeoutMs,
        );
      }),
    ]);
    asyncFindings = asyncResult.findings;
    asyncIncomplete = asyncResult.incomplete;
  } catch {
    // runAsyncChecksDetailed absorbs per-branch failures, so this is only
    // reachable on something it cannot absorb. Either way this page's async
    // layer contributed nothing, which is exactly what incomplete records.
    asyncIncomplete = plannedBranches;
  } finally {
    // Cancel the per-page async timeout once the race settles so it can't stay
    // pending across the rest of this page's work (and the next page's).
    if (asyncTimeoutHandle) clearTimeout(asyncTimeoutHandle);
  }

  // Worst first. SEVERITY_PRIORITY counts UP with severity, so this comparator
  // subtracts b from a, unlike the local table it replaced (which counted
  // critical down from 0). ref: AUDIT-013#dup-02
  const findings = dedupeScanFindings([...syncFindings, ...asyncFindings]).sort(
    (a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity],
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
    incomplete: [
      ...asyncIncomplete,
      ...(syncResult.checksErrored > 0 ? [PAGE_CHECKS_INCOMPLETE] : []),
    ],
    erroredChecks: syncResult.erroredChecks,
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
  /**
   * Opt-in: capture one above-the-fold screenshot of the crawl's MAIN URL
   * through BrowserBase (lib/scanner/page-screenshot.ts). One screenshot per
   * crawl for v1 (the entry page), not one per discovered page. Best-effort,
   * bounded, and metered exactly like the single-URL path -- see
   * ExecuteScanParams.captureScreenshot.
   */
  captureScreenshot?: boolean;
  /**
   * Opt-in: curated port/service sweep of the crawl's MAIN host
   * (lib/scanner/port-scan.ts). Host-level, so it runs once for the whole
   * crawl, not per page. Off by default and only ever set true by the route
   * after verified domain ownership -- the same gate active probing uses. See
   * ExecuteScanParams.portScan for the bounds and safety posture.
   */
  portScan?: boolean;
  /**
   * In-memory authenticated session for an authenticated crawl, established
   * once by the route (POST /api/v3/scan/crawl) before the row was created
   * and threaded into every page fetch. safeFetch attaches it only to
   * same-origin hops, so pages behind the login are crawled and scanned while
   * a cross-host redirect never carries the credentials. Lives only for this
   * in-process call: it is never written to the DB, a log line, or a
   * response. Absent for an ordinary crawl.
   */
  session?: ScanSessionBinding;
  /**
   * The non-secret fact that this crawl ran authenticated. Persisted to
   * scan_history.authenticated on completion (via finalizeScanSuccess); the
   * credential material behind it never is.
   */
  authenticated?: boolean;
  /**
   * Whether each discovered page's scan_history row is public. The route
   * resolves this (private for an authenticated crawl, or when the request
   * opted out) and MUST thread it here: scan_history.is_public defaults to
   * TRUE, so a per-page INSERT that omits it publishes every page of a private
   * or authenticated crawl on the unauthenticated /host/[hostname] surfaces.
   * Defaulting true here only matches that DB default for a caller that forgets.
   */
  isPublic?: boolean;
  /**
   * The caller's per-plan cap on how many pages one crawl may cover, resolved
   * by the route (lib/billing/crawl-page-limits.ts). Bounds BOTH the
   * pre-selected page list and the engine's own discovery below the shipped
   * CRAWL_SCAN_MAX_PAGES ceiling, so a plan's selection cap governs. Omitted or
   * -1 means no per-plan cap (billing disabled / self-hosted).
   */
  crawlPageLimit?: number;
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
/**
 * Whether the site answers the scanner with a bot challenge instead of its
 * page. A fetch that fails outright is not a challenge: the page scans report
 * that failure themselves.
 */
async function isBehindBotChallenge(
  url: string,
  fetchTimeoutMs: number,
  session?: ScanSessionBinding,
  cancelSignal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await safeFetch(
      url,
      {
        method: "GET",
        headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
        redirect: "follow",
        signal: requestSignal(fetchTimeoutMs, cancelSignal),
      },
      [new URL(url).hostname],
      session,
    );
    const body = await safeReadBody(response, 32_768);
    return detectBotChallenge(response.status, response.headers, body) !== null;
  } catch {
    return false;
  }
}

/**
 * Run a crawl inside its scan's correlation context, so every error row it
 * writes (and every check's, at any depth) carries the scan id. A crawl runs
 * detached from the request that started it, so without this nothing ties the
 * rows of one failing crawl together.
 */
export function executeCrawlScan(
  params: ExecuteCrawlScanParams,
): Promise<void> {
  return runWithScanId(params.scanId, () => runCrawlScan(params));
}

async function runCrawlScan(params: ExecuteCrawlScanParams): Promise<void> {
  const {
    scanId,
    normalizedMainUrl,
    mainOrigin,
    selectedUrls,
    scanners,
    authedUserId,
    isApiKeyAuth,
    captureScreenshot = false,
    portScan = false,
    session,
    authenticated = false,
    isPublic = true,
    crawlPageLimit,
  } = params;

  const startTime = Date.now();
  const {
    CRAWL_SCAN_TIMEOUT_SECONDS: crawlTimeoutSeconds,
    CRAWL_SCAN_MAX_PAGES: maxPagesCeiling,
    CRAWL_PAGE_FETCH_TIMEOUT_MS: fetchTimeoutMs,
    SCANNER_MAX_RESPONSE_BODY_BYTES: maxBodySize,
    SCAN_ASYNC_CHECKS_TIMEOUT_MS: configuredAsyncChecksTimeoutMs,
    SCANNER_ASYNC_BRANCH_TIMEOUT_MS: asyncBranchTimeoutMs,
  } = await getSettings([
    "CRAWL_SCAN_TIMEOUT_SECONDS",
    "CRAWL_SCAN_MAX_PAGES",
    "CRAWL_PAGE_FETCH_TIMEOUT_MS",
    "SCANNER_MAX_RESPONSE_BODY_BYTES",
    "SCAN_ASYNC_CHECKS_TIMEOUT_MS",
    "SCANNER_ASYNC_BRANCH_TIMEOUT_MS",
  ] as const);
  const asyncChecksTimeoutMs = asyncOuterTimeoutMs(
    configuredAsyncChecksTimeoutMs,
    asyncBranchTimeoutMs,
  );
  // The shipped ceiling (CRAWL_SCAN_MAX_PAGES) is a hard upper bound; the real
  // per-user governor is the plan's page-selection cap. min() of the two so a
  // plan can never exceed the ceiling and the ceiling never overrides a
  // smaller plan cap. crawlPageLimit -1/undefined (billing off) leaves the
  // ceiling in charge.
  const maxPages =
    crawlPageLimit !== undefined && crawlPageLimit > 0
      ? Math.min(maxPagesCeiling, crawlPageLimit)
      : maxPagesCeiling;
  const crawlSettings = { maxPages, fetchTimeoutMs, maxBodySize };
  const budgetMs = crawlTimeoutSeconds * 1000;
  // Measured from the moment the watchdog is armed, because that is the clock
  // the hard ceiling runs on.
  const watchdogArmedAt = Date.now();
  const softDeadlineAt = watchdogArmedAt + crawlSoftDeadlineMs(budgetMs);
  const watchdog = startWatchdog(
    scanId,
    budgetMs,
    `Crawl scan exceeded the ${crawlTimeoutSeconds}s time limit.`,
  );
  const {
    onProgress,
    setTotal,
    flush: flushProgress,
  } = createProgressTracker(scanId);
  const cancelSignal = getCancelSignal(scanId);

  try {
    await markScanRunning(scanId);

    // Automatic subdomain discovery for the crawl's main host, kicked off
    // here so it runs concurrently with the page crawl and per-page scans. It
    // resolves as soon as the per-domain cache lookup settles and never waits
    // for a fresh sweep (see subdomain-auto.ts's DEFAULT_AUTO_TIMEOUT_MS), so
    // it can never fail or stall the crawl. Reuses the manual flow's
    // per-domain cache.
    const autoSubdomainsPromise = autoDiscoverSubdomains(normalizedMainUrl, {
      signal: cancelSignal,
    });
    autoSubdomainsPromise.catch(() => {});

    // Opt-in page screenshot of the crawl's MAIN URL, kicked off concurrently
    // with discovery and the per-page scans, then awaited (bounded) before
    // result_meta is assembled. One per crawl for v1 (per-page capture is a
    // follow-up). Best-effort and self-gated inside captureAndStoreScreenshot
    // (config, plan/meter, concurrency, timeout) -- never fails or stalls the
    // crawl. A crawl is always a real http(s) host, so the only gate here is
    // the opt-in flag.
    const screenshotPromise: Promise<ScanScreenshotRef | null> =
      shouldCaptureScreenshot({
        optedIn: captureScreenshot,
        protocolType: "http",
        isRawIpTarget: false,
      })
        ? captureAndStoreScreenshot(scanId, normalizedMainUrl, {
            userId: authedUserId,
            signal: cancelSignal,
          })
        : Promise.resolve(null);
    screenshotPromise.catch(() => {});

    // Opt-in curated port/service sweep of the crawl's main host, kicked off
    // concurrently with discovery and the per-page scans, then awaited
    // (bounded) before findings are merged. Host-level, so it runs once for
    // the whole crawl. Only reaches here after the route enforced verified
    // domain ownership; best-effort, never throws, and refuses any target that
    // resolves to a private/internal address (see lib/scanner/port-scan.ts).
    let portScanHost: string | null = null;
    try {
      portScanHost = new URL(normalizedMainUrl).hostname;
    } catch {
      /* malformed URL: no host to sweep */
    }
    const portScanPromise: Promise<PortScanResult | null> =
      portScan && portScanHost
        ? scanPorts(portScanHost, cancelSignal)
        : Promise.resolve(null);
    portScanPromise.catch(() => {});

    // Use pre-selected URLs if provided, otherwise discover them.
    let pages: string[];
    if (selectedUrls && selectedUrls.length > 0) {
      const checkedUrls: string[] = [];
      // One page per address, not one per spelling of it: /landing and
      // /landing/ are the same page, and scanning both charged the quota
      // twice and listed the page twice in the result.
      const seenPages = new Set<string>();
      for (const u of selectedUrls.slice(0, maxPages)) {
        try {
          const parsed = new URL(u);
          // Restrict to same origin as the main URL to prevent cross-origin abuse
          if (parsed.origin !== mainOrigin) continue;
          const canonical = canonicalPageUrl(parsed);
          if (seenPages.has(canonical)) continue;
          const ac = await checkAccessRules(u);
          if (ac.allowed) {
            seenPages.add(canonical);
            checkedUrls.push(canonical);
          }
        } catch {
          // skip malformed URLs
        }
      }
      pages = checkedUrls;
    } else {
      pages = await discoverPages(normalizedMainUrl, crawlSettings, session);
    }

    if (pages.length === 0) {
      throw new CrawlRefusal(
        "No scannable pages were found for this URL. It may block automated crawling or have no internal links.",
        "not_run",
      );
    }

    // Daily quota: each page counts as one scan, for every auth method.
    //
    // billing: this used to fabricate an allow-everything quota for API-key
    // callers, on the reasoning that the key's own per-key limit had already
    // been checked in POST. That was wrong twice over. The key's daily limit
    // is an apiRequestsPerDay REQUEST throttle, not a scan-compute cap, and
    // the POST gate (app/api/v3/scan/crawl/route.ts) calls canMakeRequest,
    // which only reads. Since nothing on the API path ever incremented the
    // day counter, that read always reported the caller as under quota, so
    // dailyScans placed no bound at all: a free key could run 25 crawls x 25
    // pages = 625 page scans against a 25/day plan cap, and an Elite key was
    // effectively unbounded. The usage figure shown in GET /api/v3/billing
    // also stayed at zero the whole time, so neither the user nor an operator
    // could see the consumption. Charge uniformly, exactly as POST /scan and
    // POST /scan/bulk already do.
    const quotaCheck = await canMakeRequest(authedUserId);
    if (!quotaCheck.allowed) {
      throw new CrawlRefusal(
        "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
        "quota_refused",
      );
    }

    // Cap pages to remaining quota
    const maxPagesToScan =
      quotaCheck.limit === -1
        ? pages.length
        : Math.min(pages.length, quotaCheck.remaining);
    const pagesToScan = pages.slice(0, maxPagesToScan);

    // Progress denominator: every page runs the same planned set of
    // categories/page-level branches (crawl pages all share the main URL's
    // origin, so https-ness and the scanners filter are identical for each
    // one), plus the host-level branches that run exactly once.
    // The host-level branches start before any page is scanned, so they
    // cannot learn from the page scans that the site answers with a bot
    // challenge. Behind one, robots.txt, security.txt and the exposed-file
    // probes all come back as the challenge, so one look at the main page
    // decides whether those branches may use HTTP at all.
    const hostChallenged = await isBehindBotChallenge(
      normalizedMainUrl,
      fetchTimeoutMs,
      session,
      cancelSignal,
    );
    const hostScope = hostChallenged ? "network" : "host";
    const plannedHostBranches = getPlannedAsyncBranches(
      normalizedMainUrl,
      scanners,
      hostScope,
    );
    const perPageUnits =
      getPlannedSyncCategories(scanners as Category[] | null).length +
      getPlannedAsyncBranches(normalizedMainUrl, scanners, "page").length;
    setTotal(pagesToScan.length * perPageUnits + plannedHostBranches.length);

    // The host-level half of the async layer, run ONCE for the whole crawl.
    //
    // Every one of these branches answers a question about the host, not the
    // page: the DNS branch's 28 sub-checks (checkDKIM alone probes 26
    // selectors, and a domain with no DKIM costs a TXT plus a CNAME lookup
    // for each), the TLS handshake, reputation, robots.txt, security.txt and
    // the 23 fixed exposed-file paths. Running them per page meant a 25-page
    // crawl fired roughly 1,300 DKIM lookups at one domain and fetched
    // /.git/config and friends 25 times each, all to produce 25 identical
    // copies of findings the merge below then deduped away. It also looked
    // like an attack to the target's WAF and could eat the whole crawl
    // budget. Started here rather than at the top of the function so the
    // progress denominator is already set when its first event lands.
    // ref: AUDIT-012#perf-03
    const hostAsyncPromise: Promise<AsyncCheckResult> =
      plannedHostBranches.length > 0
        ? runAsyncChecksDetailed(
            normalizedMainUrl,
            scanners,
            onProgress,
            cancelSignal,
            hostScope,
          )
        : Promise.resolve({ findings: [], incomplete: [] });
    hostAsyncPromise.catch(() => {});

    // Scan the pages with a small bounded-concurrency pool. Results are
    // written back by index, so the merged output keeps the crawl's page
    // order no matter what order the pages finish in.
    const pageSlots: Array<Awaited<ReturnType<typeof scanSingleUrl>> | null> =
      Array.from({ length: pagesToScan.length }, () => null);
    let nextPageIndex = 0;
    let quotaExhausted = false;
    // Set when the soft deadline stopped the queue with pages still in it.
    let timeLimitHit = false;

    const scanPagesFromQueue = async (): Promise<void> => {
      while (!quotaExhausted) {
        // Asked here rather than left to the next progress event: a page is
        // the crawl's unit of work against someone else's server, and a
        // cancelled crawl must not start another one.
        if (isCancelled(scanId)) throw new ScanCancelledError();
        // The soft deadline. Stopping here, before the quota charge below,
        // means a page that never started is neither scanned nor billed; the
        // pages in flight finish and the crawl goes on to finalize with what
        // it has instead of running into the watchdog, which fails the whole
        // crawl and throws every finished page away.
        if (Date.now() >= softDeadlineAt) {
          if (nextPageIndex < pagesToScan.length) timeLimitHit = true;
          return;
        }
        const index = nextPageIndex++;
        if (index >= pagesToScan.length) return;
        // Charge the daily quota before each scan, for every auth method.
        // Capped + atomic so two concurrent crawls that each sized
        // pagesToScan from the same read-once `remaining` still can't push
        // the shared day counter past the cap: once the guard stops
        // recording, stop scanning the rest of this crawl's pages.
        const charge = await incrementDailyCountCapped(
          authedUserId,
          quotaCheck.limit,
        );
        if (!charge.recorded) {
          quotaExhausted = true;
          return;
        }
        pageSlots[index] = await scanSingleUrl(
          pagesToScan[index],
          maxBodySize,
          fetchTimeoutMs,
          asyncChecksTimeoutMs,
          scanners,
          onProgress,
          cancelSignal,
          session,
        );
      }
    };

    // allSettled, not all: a worker can throw (the progress hook throws
    // ScanCancelledError on a cancelled scan), and Promise.all would return
    // while its siblings kept hitting the target detached behind an already
    // -rejected promise. Wait for every worker to stop, then rethrow the
    // first real failure so the outer handler sees exactly what it used to.
    const workerOutcomes = await Promise.allSettled(
      Array.from(
        { length: Math.min(CRAWL_PAGE_CONCURRENCY, pagesToScan.length) },
        () => scanPagesFromQueue(),
      ),
    );
    const failedWorker = workerOutcomes.find((o) => o.status === "rejected");
    if (failedWorker && failedWorker.status === "rejected") {
      throw failedWorker.reason;
    }

    // Every page the crawl attempted, in crawl order. A page that could not be
    // read is still in here: its `incomplete` list is what keeps the merged
    // result from claiming coverage it did not have. Only the pages that were
    // actually read go on to be saved and listed as scanned.
    const pageResults = pageSlots.filter(
      (r): r is Awaited<ReturnType<typeof scanSingleUrl>> => r !== null,
    );
    const readPages = pageResults.filter((pr) => pr.unreachable === undefined);
    const unreachablePages = pageResults.filter(
      (pr): pr is typeof pr & { unreachable: string } =>
        pr.unreachable !== undefined,
    );
    // Discovered but never attempted: the quota capped the list up front or
    // ran out mid-crawl, or the soft deadline stopped the queue. Counted
    // against what was attempted, not against the list as first capped, so a
    // page the loop dropped partway is not reported as scanned.
    const pagesSkipped = pages.length - pageResults.length;
    const quotaLimited = pagesToScan.length < pages.length || quotaExhausted;

    // Host-level branch results. Each branch is individually bounded by
    // SCANNER_ASYNC_BRANCH_TIMEOUT_MS inside runAsyncChecksDetailed, so this
    // await cannot stall the crawl. A rejection means nothing host-level
    // reached a conclusion, which is what `incomplete` has to say: an empty
    // findings array with no marker is indistinguishable from "DNS, TLS and
    // live-fetch all ran and found nothing".
    let hostAsync: AsyncCheckResult;
    try {
      hostAsync = await hostAsyncPromise;
    } catch (err) {
      if (err instanceof ScanCancelledError) throw err;
      hostAsync = { findings: [], incomplete: plannedHostBranches };
    }

    // Every async branch that did not complete on at least one page. The
    // ceiling is applied per page, so a slow host drops a different subset of
    // DNS/TLS/live-fetch checks on each one; the union is the honest answer
    // for the merged result. Non-empty means the crawl came back short, which
    // both the engine-confidence figure and result_meta.incomplete below have
    // to reflect: a crawl that quietly reported "97% confidence, nothing
    // exploitable found" after dropping its whole TLS branch was the single
    // worst failure mode this executor had. ref: AUDIT-014#state-03
    // A challenge on some pages while others were read is not a challenge on
    // the site, and a CI gate fails on "bot-challenge" as "nothing was looked
    // at" (BLOCKING_INCOMPLETE in cli/lib.mjs). That stays true only of a
    // challenged main page (hostChallenged below) or a crawl that read nothing.
    const pageIncomplete = (slug: string) =>
      slug === BOT_CHALLENGE_INCOMPLETE && readPages.length > 0
        ? CRAWL_PAGES_CHALLENGED_INCOMPLETE
        : slug;
    const incomplete = [
      ...new Set([
        ...hostAsync.incomplete,
        ...pageResults.flatMap((pr) => pr.incomplete.map(pageIncomplete)),
        // A login that dropped mid-crawl belongs here too, and did not: the
        // single-page authenticated route records "authenticated-session"
        // (app/api/v3/scan/authenticated/route.ts) and this executor only
        // reported it through the auth badge. So a crawl whose session died
        // after page two came back with full engine confidence, no "this scan
        // did not finish" verdict, and nothing saying the signed-in area was
        // never looked at -- while every page after the drop was scanned as
        // an anonymous visitor. A clean result from those pages is not a
        // clean result for the site the user asked about.
        ...(authenticated && session?.lost ? ["authenticated-session"] : []),
        ...(hostChallenged ? [BOT_CHALLENGE_INCOMPLETE] : []),
        // Pages the crawl found and did not read. Neither used to say so:
        // a crawl cut short by the quota reported the same coverage and the
        // same engine confidence as one that read every page it discovered.
        ...(timeLimitHit ? [CRAWL_TIME_LIMIT_INCOMPLETE] : []),
        ...(quotaLimited ? [CRAWL_QUOTA_LIMIT_INCOMPLETE] : []),
      ]),
    ].sort();
    const erroredChecks = [
      ...new Set(pageResults.flatMap((pr) => pr.erroredChecks ?? [])),
    ].sort();

    // Merge the pages into one list where each problem appears ONCE, with the
    // pages it was seen on (lib/scanner/crawl-merge.ts). This used to dedupe
    // by id alone, and an id folds in the page URL, so the same missing header
    // on every page survived once per page: a crawl of a Moodle site reported
    // 3,177 findings for problems a single-page scan counts under a hundred
    // times, and the summary, danger score and site grade were all computed
    // from that. Host-level findings go in first so the id kept is the main
    // URL's, which is what keeps triage attached across a rescan.
    let allFindings: Vulnerability[] = mergeFindingsAcrossPages([
      { url: normalizedMainUrl, findings: hostAsync.findings },
      ...pageResults.map((pr) => ({ url: pr.url, findings: pr.findings })),
    ]);
    const seenIds = new Set(allFindings.map((f) => f.id));

    // Curated port sweep result, captured concurrently above (host-level, once
    // per crawl). scanPorts never rejects; null when not opted in, unsafe, or
    // cancelled. Its risky open ports merge (deduped by id) into the same array
    // that becomes the persisted findings, and the full structured result is
    // stored in result_meta below.
    let portScanResult: PortScanResult | null = null;
    try {
      portScanResult = await portScanPromise;
    } catch {
      /* never: scanPorts swallows its own errors */
    }
    if (portScanResult && portScanHost) {
      for (const f of buildRiskyPortFindings(
        portScanHost,
        normalizedMainUrl,
        portScanResult.open,
      )) {
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          allFindings.push(f);
        }
      }
    }

    // General software inventory + version-to-CVE correlation for the crawl's
    // main host. Every same-host page's fingerprint was merged into one
    // per-host side channel above; read it back once and correlate (bounded,
    // capped, per host+item cached, fail-open -- see software-inventory.ts).
    // Its aggregated per-software CVE findings merge (deduped by id) into the
    // same array BEFORE the exploit-intel pass, so they too pick up KEV/EPSS
    // from their own CVE-naming text; the structured inventory goes to
    // result_meta below.
    let softwareInventory: Awaited<ReturnType<typeof correlateSoftwareCves>> =
      null;
    try {
      let mainHost: string | null = null;
      try {
        mainHost = new URL(normalizedMainUrl).hostname;
      } catch {
        /* malformed URL: no host to correlate */
      }
      const fingerprint = mainHost
        ? readSoftwareFingerprint(mainHost)
        : undefined;
      if (fingerprint && fingerprint.length > 0) {
        softwareInventory = await correlateSoftwareCves(
          normalizedMainUrl,
          fingerprint,
          cancelSignal,
        );
        for (const f of softwareInventory?.findings ?? []) {
          if (!seenIds.has(f.id)) {
            seenIds.add(f.id);
            allFindings.push(f);
          }
        }
      }
    } catch {
      /* never: correlateSoftwareCves swallows its own errors */
    }

    allFindings.sort(
      (a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity],
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

    // Adaptive confidence, same as execute-scan.ts: discounts confidence
    // for a check with a real, statistically meaningful false-positive
    // rate from user feedback. Fail-open, applied to the merged array only.
    allFindings = await applyAdaptiveConfidence(allFindings);

    // Safety-net pass, same as execute-scan.ts: every finding in the merged
    // array carries a CVSS 3.1 vector/score regardless of which check or
    // page produced it.
    allFindings = attachCvssScores(allFindings);

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

    // The first page that was actually read supplies the main headers. An
    // unreachable page has none to give.
    const mainHeaders = readPages[0]?.responseHeaders || {};
    const scannedAt = new Date().toISOString();

    // Team assignment for the per-page rows, read back off the tracker row
    // the route already resolved it onto. The child rows used to omit
    // team_id entirely, so a crawl started for a team put the tracker row in
    // the team's history and every discovered page's row outside it: the team
    // could open the crawl but not a single one of its pages. Reading it here
    // rather than taking it as a parameter keeps the child rows definitionally
    // in step with the parent. ref: AUDIT-011#drift-01
    let crawlTeamId: number | null = null;
    try {
      const teamRes = await pool.query<{ team_id: number | null }>(
        `SELECT team_id FROM scan_history WHERE id = $1`,
        [scanId],
      );
      crawlTeamId = teamRes.rows[0]?.team_id ?? null;
    } catch (err) {
      logError("scan", "could not read the crawl's team assignment", err, {
        scanId,
        userId: authedUserId,
      });
    }

    // Save EACH page that was read as its own history entry (like bulk scan),
    // separate from the tracker row this whole job is reported against. A page
    // that could not be read gets no row: it would be saved as a completed
    // scan with no findings and read as clean in History. It is listed in
    // result_meta.crawl.pagesUnreachable below instead.
    let pageHistoryIds: Record<string, number> = {};
    // The host's certificate grade, shared by every same-host page. Read here
    // rather than only for the tracker below, because each page row carries it
    // too.
    let hostSslGrade: string | undefined;
    try {
      hostSslGrade = readSslGrade(new URL(normalizedMainUrl).hostname);
    } catch {
      /* malformed URL: no grade */
    }
    // A cancel or the watchdog can land in the stretch since the page loop:
    // the enrichment passes above run for seconds on a big crawl, and nothing
    // asked again. The rows are written before finalizeScanSuccess applies its
    // own status guard, so without this a crawl the owner cancelled ended up
    // `failed` with up to 250 of its pages in History as completed scans.
    // insertCrawlPageRows closes the remaining window inside the statement
    // itself, for a row that went terminal without this process knowing.
    if (isCancelled(scanId) || cancelSignal.aborted) {
      throw new ScanCancelledError();
    }
    if (readPages.length > 0) {
      try {
        pageHistoryIds = await insertCrawlPageRows(
          scanId,
          {
            userId: authedUserId,
            scannedAt,
            source: isApiKeyAuth ? "api" : "web",
            notes: DEFAULT_SCAN_NOTE,
            isPublic,
            authenticated,
            teamId: crawlTeamId,
          },
          readPages.map((pr) => ({
            url: pr.url,
            summary: pr.summary,
            findings: pr.findings,
            findingsCount: pr.summary.total,
            duration: pr.duration,
            responseHeaders: pr.responseHeaders,
            // Each page row's own result_meta. It was never written: every
            // per-page row a crawl saved had summary, findings and duration
            // and nothing else, so opening one from History showed "Duration"
            // and "Scanned" and none of the risk score, site grade, SSL
            // grade, confidence or checks-run a scan result shows everywhere
            // else, because the summary renders each of those only when
            // present. Computed from THIS page's findings, the same way the
            // tracker's are computed from the merged set.
            resultMeta: {
              dangerScore: getDangerScore(pr.findings),
              siteGrade: getSiteGrade(pr.findings),
              engineConfidence: getEngineConfidence(
                pr.findings,
                pr.incomplete.length > 0,
              ),
              ...(typeof pr.checksRun === "number"
                ? { checksRun: pr.checksRun }
                : {}),
              ...(pr.incomplete.length > 0
                ? { incomplete: pr.incomplete }
                : {}),
              ...(pr.erroredChecks && pr.erroredChecks.length > 0
                ? { erroredChecks: pr.erroredChecks }
                : {}),
              ...(hostSslGrade ? { sslGrade: hostSslGrade } : {}),
            },
          })),
        );
      } catch (err) {
        logError("scan", "could not save the crawl's page rows", err, {
          scanId,
          userId: authedUserId,
          pages: readPages.length,
        });
      }
    }

    // SSL/TLS letter grade for the crawl's main host. Every same-host page's
    // TLS branch records under one hostname key (lib/scanner/ssl-grade.ts), so
    // reading by the main host resolves the shared grade. Only stored when
    // present -- a missing grade must never render as "F".
    const sslGrade = hostSslGrade;

    // Full structured DNS record set for the crawl's main host, resolved in
    // the DNS branch and read from the same per-host side channel
    // (lib/scanner/dns-records.ts). Only stored when present.
    let dnsRecords: ReturnType<typeof readDnsRecords>;
    try {
      dnsRecords = readDnsRecords(new URL(normalizedMainUrl).hostname);
    } catch {
      /* malformed URL: no records */
    }

    // Multi-source threat-intel summary for the crawl's main host. Every
    // same-host page's reputation branch records under one hostname key
    // (host-based sources are cached, so the query runs once for the whole
    // crawl), so reading by the main host resolves the shared summary. Only
    // stored when present.
    let threatIntel: ReturnType<typeof readThreatIntel>;
    try {
      threatIntel = readThreatIntel(new URL(normalizedMainUrl).hostname);
    } catch {
      /* malformed URL: no summary */
    }

    // Auto-discovered subdomains for the crawl's main host, captured
    // concurrently above and read from the same per-host side channel
    // (lib/scanner/subdomain-auto.ts). Only stored when present.
    try {
      await autoSubdomainsPromise;
    } catch {
      /* never: autoDiscoverSubdomains swallows its own errors */
    }
    let subdomains: ReturnType<typeof readSubdomains>;
    try {
      subdomains = readSubdomains(new URL(normalizedMainUrl).hostname);
    } catch {
      /* malformed URL: no subdomains */
    }

    // Opt-in main-URL screenshot reference, captured concurrently above.
    // Never rejects; null when not opted in / unconfigured / meter
    // exhausted / capture failed. Only the reference is stored, not bytes.
    let screenshot: ScanScreenshotRef | null = null;
    try {
      screenshot = await screenshotPromise;
    } catch {
      /* never: captureAndStoreScreenshot swallows its own errors */
    }

    // Authentication outcome for an authenticated crawl, mirroring the
    // single-URL authenticated route so the result UI can show the same auth
    // badge. Built from the session binding (its non-secret authType/lost/
    // reason), never from the credential material -- which stayed in the
    // route and never reached this function. "lost" when the target dropped
    // the session at some point during the multi-page crawl; "authenticated"
    // when it held to the end. Absent for an ordinary crawl.
    const authReport: ScanAuthReport | undefined =
      authenticated && session
        ? {
            status: session.lost ? "lost" : "authenticated",
            method: session.authType ?? "form",
            reason: session.lost && session.reason ? session.reason : undefined,
          }
        : undefined;

    const crawlChecksRun = Math.max(
      0,
      ...readPages.map((pr) => pr.checksRun ?? 0),
    );

    const applied = await finalizeScanSuccess(scanId, {
      summary: mergedSummary,
      findings: allFindings,
      duration: totalDuration,
      scannedAt,
      responseHeaders: mainHeaders,
      // Non-secret boolean fact only; the session and credentials never persist.
      ...(authenticated ? { authenticated: true } : {}),
      resultMeta: {
        // How many distinct checks ran, which is what the figure means on a
        // single scan: the most any page ran, not the sum. A sum would say a
        // ten-page crawl ran ten times the catalogue. It was missing entirely,
        // so a crawl's summary was the only one without it.
        ...(crawlChecksRun > 0 ? { checksRun: crawlChecksRun } : {}),
        // Same summary stats the single-URL path stores (execute-scan.ts), so a
        // crawl result shows Risk score + Engine confidence like any other scan
        // instead of leaving those stats silently blank. Computed from the
        // merged, deduped findings across every crawled page.
        dangerScore: getDangerScore(allFindings),
        // The same whole-site A+ to F letter the single-URL path stores
        // (execute-scan.ts). A crawl was the odd one out: it produced no
        // siteGrade at all, so a crawl result showed no site grade and a
        // badge pointed at one had to recompute what every other scan had
        // already written down. Computed over the merged, deduped findings
        // for the same reason dangerScore above is.
        siteGrade: getSiteGrade(allFindings),
        engineConfidence: getEngineConfidence(
          allFindings,
          incomplete.length > 0,
        ),
        ...(authReport ? { authReport } : {}),
        ...(incomplete.length > 0 ? { incomplete } : {}),
        ...(erroredChecks.length > 0 ? { erroredChecks } : {}),
        ...(sslGrade ? { sslGrade } : {}),
        ...(dnsRecords ? { dnsRecords } : {}),
        ...(subdomains ? { subdomains } : {}),
        ...(screenshot ? { screenshot } : {}),
        ...(portScanResult ? { portScan: portScanResult } : {}),
        ...(threatIntel ? { threatIntel } : {}),
        ...(softwareInventory?.inventory
          ? { softwareInventory: softwareInventory.inventory }
          : {}),
        // The four counts add up to pagesDiscovered: read, could not be read,
        // and never attempted. `pagesSkipped` is the last of those only. It
        // was counted against the list as first capped to the quota, so a
        // crawl the quota stopped partway (or the time limit, now) left the
        // pages it dropped out of every figure and read as complete.
        crawl: {
          pagesDiscovered: pages.length,
          pagesScanned: readPages.length,
          pagesSkipped,
          pagesUnreachable: unreachablePages.map((p) => ({
            url: p.url,
            reason: p.unreachable,
          })),
          pages: readPages.map((p) => ({
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
    // cancellation raced this completion) -- don't notify for a result
    // nobody will see.
    //
    // Say so when it was the watchdog, though: a crawl that finished after its
    // budget threw a finished result away without a trace, and the owner saw
    // a timeout with every page already scanned. Past the budget is how it is
    // told from a cancel in the last moments, which is an outcome and not an
    // error (STYLE.md, "Logging").
    //
    // A crawl used to send exactly one notification, the critical/high
    // regression alert, and no scan-complete email and no webhook at all:
    // `--crawl` is what the CLI and the GitHub Action expose, so a CI-facing
    // path finished in near silence. It now runs the same shared tail as
    // every other scan path (lib/webhooks/scan-notifications.ts), which owns
    // the regression alert too. The inline copy that used to live here is
    // gone rather than kept alongside it, so there is no second email.
    if (!applied) {
      const lateByMs = Date.now() - watchdogArmedAt - budgetMs;
      if (lateByMs > 0) {
        logError(
          "scan",
          "crawl completed after the row was terminal; result discarded",
          undefined,
          {
            scanId,
            userId: authedUserId,
            lateByMs,
            budgetSeconds: crawlTimeoutSeconds,
            pagesScanned: readPages.length,
            findings: allFindings.length,
          },
        );
      }
      return;
    }
    void notifyScanComplete({
      userId: authedUserId,
      scanId,
      // The main URL, which is what this crawl's tracker row stores as
      // scan_history.url and therefore the key the regression diff needs.
      target: { kind: "url", value: normalizedMainUrl },
      summary: mergedSummary,
      findings: allFindings,
      duration: totalDuration,
      scannedAt,
      // A crawl accumulates unfinished branches across every page it
      // visited; the same list result_meta.incomplete stores.
      incomplete,
    });
  } catch (error) {
    // The flag is the cancel's own record, so it is asked before the error is
    // read: a fetch aborted by the cancel surfaces as an AbortError, not a
    // ScanCancelledError, and a cancel is not a crawl that failed.
    if (
      error instanceof ScanCancelledError ||
      isCancelled(scanId) ||
      cancelSignal.aborted
    ) {
      await finalizeScanFailure(scanId, "Cancelled", "cancelled");
    } else if (error instanceof CrawlRefusal) {
      await finalizeScanFailure(scanId, error.message, error.kind);
    } else {
      logError("scan", "crawl scan failed", error, {
        scanId,
        userId: authedUserId,
        source: isApiKeyAuth ? "api" : "web",
        url: normalizedMainUrl,
      });
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during the crawl scan.";
      await finalizeScanFailure(scanId, message, "internal");
    }
  } finally {
    clearTimeout(watchdog);
    // Land any coalesced progress and stop the flush timer. ref: AUDIT-012#perf-12
    flushProgress();
    // Same reasoning as execute-scan.ts: the cancellation controller must
    // outlive the work, not the row. ref: AUDIT-012#abuse-06
    clearCancel(scanId);
  }
}
