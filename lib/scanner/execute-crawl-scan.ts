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
import { runSyncChecksYielding, getPlannedSyncCategories } from "./engine";
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
} from "./scan-jobs";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  SEVERITY_LEVELS,
  SEVERITY_PRIORITY,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { Vulnerability, Category, ScanProgressHook } from "./types";
import { checkAccessRules } from "./access-rules";
import { safeFetch } from "./safe-fetch";
import { safeReadBody } from "./read-bounded-body";
import { discoverPages } from "./crawl-discovery";
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

async function scanSingleUrl(
  url: string,
  maxBodySize: number,
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
        signal: AbortSignal.timeout(15000),
      },
      [urlObj.hostname],
      session,
    );
  } catch {
    // The page could not be fetched at all, so nothing ran against it. That
    // is a hole in the crawl, not a clean page: report every planned branch
    // as not completed so the merged result cannot claim coverage it never
    // had. ref: AUDIT-014#state-03
    return {
      url,
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
      duration: Date.now() - startTime,
      responseHeaders: {},
      incomplete: plannedBranches,
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

  const bodyForChecks =
    responseBody.length > 1_000_000
      ? responseBody.slice(0, 1_000_000)
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
          15000,
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
  const findings = [...syncFindings, ...asyncFindings].sort(
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
    incomplete: asyncIncomplete,
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
  } = await getSettings([
    "CRAWL_SCAN_TIMEOUT_SECONDS",
    "CRAWL_SCAN_MAX_PAGES",
    "CRAWL_PAGE_FETCH_TIMEOUT_MS",
    "SCANNER_MAX_RESPONSE_BODY_BYTES",
  ] as const);
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
  const watchdog = startWatchdog(
    scanId,
    crawlTimeoutSeconds * 1000,
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
      for (const u of selectedUrls.slice(0, maxPages)) {
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
      pages = await discoverPages(normalizedMainUrl, crawlSettings, session);
    }

    if (pages.length === 0) {
      throw new Error(
        "No scannable pages were found for this URL. It may block automated crawling or have no internal links.",
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
    // categories/page-level branches (crawl pages all share the main URL's
    // origin, so https-ness and the scanners filter are identical for each
    // one), plus the host-level branches that run exactly once.
    const plannedHostBranches = getPlannedAsyncBranches(
      normalizedMainUrl,
      scanners,
      "host",
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
            "host",
          )
        : Promise.resolve({ findings: [], incomplete: [] });
    hostAsyncPromise.catch(() => {});

    // Scan the pages with a small bounded-concurrency pool. Results are
    // written back by index, so the merged output keeps the crawl's page
    // order no matter what order the pages finish in.
    const pageSlots: Array<Awaited<ReturnType<typeof scanSingleUrl>> | null> =
      new Array(pagesToScan.length).fill(null);
    let nextPageIndex = 0;
    let quotaExhausted = false;

    const scanPagesFromQueue = async (): Promise<void> => {
      while (!quotaExhausted) {
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

    const pageResults = pageSlots.filter(
      (r): r is Awaited<ReturnType<typeof scanSingleUrl>> => r !== null,
    );

    // Host-level branch results. Each branch is individually bounded by
    // SCANNER_ASYNC_BRANCH_TIMEOUT_MS inside runAsyncChecksDetailed, so this
    // await cannot stall the crawl. A rejection means nothing host-level
    // reached a conclusion, which is what `incomplete` has to say: an empty
    // findings array with no marker is indistinguishable from "DNS, TLS and
    // live-fetch all ran and found nothing".
    let hostAsync: AsyncCheckResult = { findings: [], incomplete: [] };
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
    const incomplete = [
      ...new Set([
        ...hostAsync.incomplete,
        ...pageResults.flatMap((pr) => pr.incomplete),
      ]),
    ].sort();

    // Merge all findings, deduplicating by id. Host-level findings go in
    // first so their id (which folds in the URL they were raised against) is
    // the crawl's main URL rather than whichever page happened to be scanned
    // first.
    const seenIds = new Set<string>();
    let allFindings: Vulnerability[] = [];
    for (const f of hostAsync.findings) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        allFindings.push(f);
      }
    }
    for (const pr of pageResults) {
      for (const f of pr.findings) {
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          allFindings.push(f);
        }
      }
    }

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

    // Use first page's response headers as the main headers
    const mainHeaders = pageResults[0]?.responseHeaders || {};
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
      console.error(
        `[${APP_NAME}] Failed to read crawl team assignment:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Save EACH page as its own history entry (like bulk scan), separate
    // from the tracker row this whole job is reported against.
    //
    // One multi-row INSERT, not one per page: this used to be a sequential
    // loop, so an Elite crawl paid up to 250 serialized round trips at the
    // very tail of a scan the user is already waiting on. Built the same way
    // saveAutoTags (lib/tags/auto-tags.ts) builds its parameter list. The ids
    // come back keyed by url rather than by position, because RETURNING row
    // order is not something Postgres promises. ref: AUDIT-012#perf-26
    const pageHistoryIds: Record<string, number> = {};
    if (pageResults.length > 0) {
      const COLUMNS = 13;
      const tuples: string[] = [];
      const params: unknown[] = [];
      for (const pr of pageResults) {
        const base = params.length;
        tuples.push(
          `(${Array.from({ length: COLUMNS }, (_, i) => `$${base + i + 1}`).join(", ")})`,
        );
        params.push(
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
          isPublic,
          authenticated,
          crawlTeamId,
        );
      }
      try {
        const insertResult = await pool.query<{ id: number; url: string }>(
          `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes, is_public, authenticated, team_id)
           VALUES ${tuples.join(", ")} RETURNING id, url`,
          params,
        );
        for (const row of insertResult.rows) {
          pageHistoryIds[row.url] = row.id;
        }
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to save crawl history:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // SSL/TLS letter grade for the crawl's main host. Every same-host page's
    // TLS branch records under one hostname key (lib/scanner/ssl-grade.ts), so
    // reading by the main host resolves the shared grade. Only stored when
    // present -- a missing grade must never render as "F".
    let sslGrade: string | undefined;
    try {
      sslGrade = readSslGrade(new URL(normalizedMainUrl).hostname);
    } catch {
      /* malformed URL: no grade */
    }

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

    const applied = await finalizeScanSuccess(scanId, {
      summary: mergedSummary,
      findings: allFindings,
      duration: totalDuration,
      scannedAt,
      responseHeaders: mainHeaders,
      // Non-secret boolean fact only; the session and credentials never persist.
      ...(authenticated ? { authenticated: true } : {}),
      resultMeta: {
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
        ...(sslGrade ? { sslGrade } : {}),
        ...(dnsRecords ? { dnsRecords } : {}),
        ...(subdomains ? { subdomains } : {}),
        ...(screenshot ? { screenshot } : {}),
        ...(portScanResult ? { portScan: portScanResult } : {}),
        ...(threatIntel ? { threatIntel } : {}),
        ...(softwareInventory?.inventory
          ? { softwareInventory: softwareInventory.inventory }
          : {}),
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
    // cancellation raced this completion) -- don't notify for a result
    // nobody will see.
    //
    // A crawl used to send exactly one notification, the critical/high
    // regression alert, and no scan-complete email and no webhook at all:
    // `--crawl` is what the CLI and the GitHub Action expose, so a CI-facing
    // path finished in near silence. It now runs the same shared tail as
    // every other scan path (lib/webhooks/scan-notifications.ts), which owns
    // the regression alert too. The inline copy that used to live here is
    // gone rather than kept alongside it, so there is no second email.
    if (applied) {
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
    // Land any coalesced progress and stop the flush timer. ref: AUDIT-012#perf-12
    flushProgress();
    // Same reasoning as execute-scan.ts: the cancellation controller must
    // outlive the work, not the row. ref: AUDIT-012#abuse-06
    clearCancel(scanId);
  }
}
