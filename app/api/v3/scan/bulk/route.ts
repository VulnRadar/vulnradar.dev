import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  canMakeRequest,
  checkAndRecordRequest,
  getRateLimitHeaders,
} from "@/lib/rate-limiting/daily-limits";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { getUserPlanLimits, planLimitMessage } from "@/lib/billing/plan-limits";
import { runSyncChecks } from "@/lib/scanner/engine";
import { runAsyncChecks } from "@/lib/scanner/async-checks";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  SEVERITY_LEVELS,
  SEVERITY_PRIORITY,
  BEARER_PREFIX,
} from "@/lib/config/constants";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import type { Vulnerability } from "@/lib/scanner/types";
import { getProtocolFromUrl } from "@/lib/scanner/protocols";
import { runWebSocketChecks } from "@/lib/scanner/protocols/websocket";
import { runFtpChecks } from "@/lib/scanner/protocols/ftp";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";
import { upsertHostReputation } from "@/lib/scanner/host-reputation";
import { saveAutoTags, maybeSuggestAiTag } from "@/lib/tags/auto-tags";

const SUPPORTED_PROTOCOLS = ["http:", "https:", "ws:", "wss:", "ftp:", "ftps:"];

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

function getProtocolType(url: string): "http" | "websocket" | "ftp" {
  const protocol = getProtocolFromUrl(url);
  if (protocol === "ws" || protocol === "wss") return "websocket";
  if (protocol === "ftp" || protocol === "ftps") return "ftp";
  return "http";
}

async function runSingleScan(
  url: string,
  userId: number,
  isApiKeyAuth: boolean,
  isPublic: boolean,
  scanSettings: {
    fetchTimeoutMs: number;
    asyncChecksTimeoutMs: number;
    maxBodySize: number;
  },
) {
  const {
    fetchTimeoutMs,
    asyncChecksTimeoutMs,
    maxBodySize: MAX_BODY_SIZE,
  } = scanSettings;
  const startTime = Date.now();

  // SSRF protection - validate target is not internal/private
  const safetyCheck = await validateScanTarget(url);
  if (!safetyCheck.safe) {
    return {
      url,
      success: false,
      error: safetyCheck.reason || "URL blocked for security reasons",
    };
  }

  // Check access rules (blacklist/whitelist)
  const accessCheck = await checkAccessRules(url);
  if (!accessCheck.allowed) {
    return {
      url,
      success: false,
      error: "This target cannot be scanned.",
      details:
        "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data.",
    };
  }

  const protocolType = getProtocolType(url);

  let response: Response | null = null;
  let responseBody = "";
  let headers = new Headers();
  let capturedHeaders: Record<string, string> = {};
  const protocolSpecificFindings: Vulnerability[] = [];

  // Handle different protocol types
  if (protocolType === "websocket") {
    // For WebSocket URLs, convert to HTTP(S) for initial check
    try {
      // Parse WebSocket URL and reconstruct as HTTP(S)
      const wsUrl = new URL(url);
      if (wsUrl.protocol !== "ws:" && wsUrl.protocol !== "wss:") {
        throw new Error("Invalid WebSocket protocol");
      }

      // Validate the hostname and pathname
      if (!wsUrl.hostname || !wsUrl.hostname.length) {
        throw new Error("Invalid hostname");
      }

      // Construct HTTP(S) URL from individual components
      const protocol = wsUrl.protocol === "wss:" ? "https" : "http";
      const hostname = wsUrl.hostname;
      const port = wsUrl.port ? `:${wsUrl.port}` : "";
      const pathname = wsUrl.pathname || "";
      const search = wsUrl.search || "";

      const safeUrl = new URL(
        `${protocol}://${hostname}${port}${pathname}${search}`,
      );

      // Validate the constructed URL
      if (safeUrl.protocol !== "http:" && safeUrl.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }

      // Use safeFetch which validates the URL internally to prevent SSRF
      // Pass the original hostname as the only allowed hostname to prevent redirect-based SSRF
      response = await safeFetch(
        safeUrl.href,
        {
          method: "GET",
          headers: { "User-Agent": `${APP_NAME}/1.0 (Security Scanner)` },
          redirect: "follow",
          signal: AbortSignal.timeout(fetchTimeoutMs),
        },
        [hostname],
      );
      responseBody = await safeReadBody(response, MAX_BODY_SIZE);
      headers = response.headers;
      headers.forEach((v, k) => {
        capturedHeaders[k] = v;
      });
    } catch {
      // WebSocket endpoint may not respond to HTTP - that's ok
    }
    // Add WebSocket-specific security checks
    protocolSpecificFindings.push(...runWebSocketChecks(url, headers));
  } else if (protocolType === "ftp") {
    // FTP protocol checks - limited to protocol-level security
    protocolSpecificFindings.push(...runFtpChecks(url));
  } else {
    // Standard HTTP/HTTPS fetch
    try {
      // Validate URL before fetch to prevent SSRF
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
          signal: AbortSignal.timeout(fetchTimeoutMs),
        },
        [urlObj.hostname],
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { url, success: false, error: `Could not reach: ${msg}` };
    }

    responseBody = await safeReadBody(response, MAX_BODY_SIZE);
    headers = response.headers;
    headers.forEach((v, k) => {
      capturedHeaders[k] = v;
    });
  }

  // Sync checks (only run on HTTP-like protocols)
  const bodyForChecks =
    responseBody.length > 1_000_000
      ? responseBody.slice(0, 1_000_000)
      : responseBody;
  let syncFindings: Vulnerability[] = [];
  if (protocolType === "http" || protocolType === "websocket") {
    syncFindings = runSyncChecks(url, headers, bodyForChecks).findings;
  }

  // Async checks (only run on HTTP)
  let asyncFindings: Vulnerability[] = [];
  if (protocolType === "http") {
    try {
      asyncFindings = await Promise.race([
        runAsyncChecks(url),
        new Promise<Vulnerability[]>((resolve) =>
          setTimeout(() => resolve([]), asyncChecksTimeoutMs),
        ),
      ]);
    } catch {
      /* non-fatal */
    }
  }

  const findings = [
    ...protocolSpecificFindings,
    ...syncFindings,
    ...asyncFindings,
  ].sort(
    (a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity],
  );

  const duration = Date.now() - startTime;
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

  // Save to history
  let scanHistoryId: number | null = null;
  const scannedAt = new Date().toISOString();
  // scanner: redact sensitive response headers (Set-Cookie, Cookie,
  // Authorization) before persisting. Declared outside the try block below
  // since upsertHostReputation also needs it, whether or not the
  // scan_history insert itself succeeds.
  const redactedBulkHeaders = redactSensitiveResponseHeaders(capturedHeaders);
  try {
    const { DEFAULT_SCAN_NOTE } = await import("@/lib/config/constants");
    const insertResult = await pool.query(
      `INSERT INTO scan_history (user_id, url, summary, findings, findings_count, duration, scanned_at, source, response_headers, notes, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      // source must be either 'api' or 'web'
      [
        userId,
        url,
        JSON.stringify(summary),
        JSON.stringify(findings),
        summary.total,
        duration,
        scannedAt,
        isApiKeyAuth ? "api" : "web",
        JSON.stringify(redactedBulkHeaders),
        DEFAULT_SCAN_NOTE,
        isPublic,
      ],
    );
    scanHistoryId = insertResult.rows[0]?.id || null;
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to save bulk scan history:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Host-level reputation cache for the browser extension's popup and the
  // public /host/[hostname] page. Bulk scan writes scan_history directly
  // instead of going through lib/scanner/scan-jobs.ts's finalizeScanSuccess,
  // so it upserts here too -- skipped for a batch the caller asked to keep
  // private (scan_history.is_public).
  if (isPublic) {
    void upsertHostReputation({
      url,
      findings,
      summary,
      responseHeaders: redactedBulkHeaders,
      scanId: scanHistoryId,
      scannedAt,
    });
  }

  // Auto tags (lib/tags/auto-tags.ts): unlike host_reputation above, not
  // gated on isPublic -- they're personal to the user's own scan record,
  // not the public reputation cache. Fire-and-forget: never blocks or
  // fails the batch response. Chained (not awaited) rather than a second
  // independent `void` call: by the time saveAutoTags' own promise
  // resolves, this row's INSERT has already committed (this route writes
  // the whole scan_history row in one INSERT, no pending/running status
  // flip to wait on), so maybeSuggestAiTag is always safe to fire right
  // after -- see its own comment for why that ordering matters.
  if (scanHistoryId) {
    const savedScanId = scanHistoryId;
    void saveAutoTags(savedScanId, userId, findings).then((tags) => {
      void maybeSuggestAiTag(savedScanId, userId, tags, findings);
    });
  }

  return {
    url,
    success: true,
    scanHistoryId,
    summary,
    findings_count: summary.total,
    duration,
  };
}

export async function POST(request: NextRequest) {
  if (!(await getSetting("FEATURE_BULK_SCANS"))) {
    return NextResponse.json(
      { error: "Bulk scanning is disabled on this deployment." },
      { status: 403 },
    );
  }

  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let apiKeyId: number | null = null;
  let apiKeyDailyLimit: number | null = null;
  let isApiKeyAuth = false;
  let authedUserId: number | null = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    const keyData = await validateApiKey(token);

    if (!keyData) {
      return NextResponse.json(
        { error: "Invalid or revoked API key." },
        { status: 401 },
      );
    }

    // Check if user needs to accept updated terms
    if (keyData.needsTermsAcceptance) {
      return NextResponse.json(
        {
          error:
            "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        },
        { status: 403 },
      );
    }

    // scoping: triggering scans requires scan:write.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
        { status: 403 },
      );
    }

    // Early-rejection check: if the key is already exhausted, bail now
    // without consuming another slot. Per-URL billing happens in the scan
    // loop below — each URL consumes one rate-limit slot so a 100-URL
    // bulk call costs 100 towards the daily limit, not 1.
    const earlyCheck = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );

    if (!earlyCheck.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded.",
          limit: earlyCheck.limit,
          used: earlyCheck.used,
          remaining: earlyCheck.remaining,
          resets_at: earlyCheck.resetsAt,
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(earlyCheck.limit),
            "X-RateLimit-Remaining": String(earlyCheck.remaining),
            "X-RateLimit-Reset": earlyCheck.resetsAt,
            "Retry-After": String(
              Math.ceil(
                (new Date(earlyCheck.resetsAt).getTime() - Date.now()) / 1000,
              ),
            ),
          },
        },
      );
    }

    apiKeyId = keyData.keyId;
    apiKeyDailyLimit = keyData.dailyLimit;
    isApiKeyAuth = true;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        {
          error:
            "Unauthorized. Provide an API key via Authorization: Bearer <key> header, or sign in.",
        },
        { status: 401 },
      );
    }
    authedUserId = session.userId;

    const rl = await checkRateLimit({
      key: `bulkscan:${session.userId}`,
      ...RATE_LIMITS.bulkScan,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Bulk scan rate limit reached. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429 },
      );
    }
  }

  const { urls, isPublic } = await request.json();
  // Public by default (matches scan_history.is_public's DB default) -- one
  // flag for the whole batch, since a bulk scan has no per-URL privacy UI.
  const requestedIsPublic = isPublic !== false;

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json(
      { error: "Provide an array of URLs." },
      { status: 400 },
    );
  }
  const {
    MAX_URL_LENGTH,
    MAX_URLS_BULK,
    SCAN_FETCH_TIMEOUT_MS,
    SCAN_ASYNC_CHECKS_TIMEOUT_MS,
    SCAN_RESPONSE_BODY_MAX_BYTES,
  } = await getSettings([
    "MAX_URL_LENGTH",
    "MAX_URLS_BULK",
    "SCAN_FETCH_TIMEOUT_MS",
    "SCAN_ASYNC_CHECKS_TIMEOUT_MS",
    "SCAN_RESPONSE_BODY_MAX_BYTES",
  ] as const);
  const scanSettings = {
    fetchTimeoutMs: Number(SCAN_FETCH_TIMEOUT_MS),
    asyncChecksTimeoutMs: Number(SCAN_ASYNC_CHECKS_TIMEOUT_MS),
    maxBodySize: Number(SCAN_RESPONSE_BODY_MAX_BYTES),
  };

  // scanner: per-URL length cap shared with scan/route.ts. Without
  // this, a 50 MB URL string slips through and hits DB + DNS.
  for (const u of urls) {
    if (typeof u !== "string") {
      return NextResponse.json(
        { error: "Each entry must be a string URL." },
        { status: 400 },
      );
    }
    if (u.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        {
          error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }
  }
  // scanner: enforce the configured MAX_URLS_BULK (default 100)
  // instead of the hardcoded 10. Self-hosters configuring
  // MAX_URLS_BULK get the cap they expect.
  if (urls.length > MAX_URLS_BULK) {
    return NextResponse.json(
      {
        error: `Maximum ${MAX_URLS_BULK} URLs per bulk scan.`,
      },
      { status: 400 },
    );
  }

  // billing: per-plan bulk-scan URL cap, tighter (or looser, up to
  // MAX_URLS_BULK above) than the flat deployment-wide ceiling. null means
  // billing is off (unlimited here too) -- a staff caller now resolves to
  // the Pro Supporter plan's real bulkScanUrls cap, not null. This is
  // a batch-size check ("how many URLs in this one submission"), not a
  // "how many of this resource do you already have" check, so it uses the
  // same `> cap` comparison as the MAX_URLS_BULK check just above --
  // withinPlanLimit()'s `current < limit` is right for the latter (you need
  // room for one more before creating it) but wrong here: a cap of exactly
  // N must accept a submission of exactly N URLs, the same way
  // MAX_URLS_BULK does.
  const bulkScanPlanLimits = await getUserPlanLimits(authedUserId!);
  if (
    bulkScanPlanLimits &&
    bulkScanPlanLimits.bulkScanUrls !== -1 &&
    urls.length > bulkScanPlanLimits.bulkScanUrls
  ) {
    return NextResponse.json(
      {
        error: planLimitMessage(
          "URLs per bulk scan",
          bulkScanPlanLimits.bulkScanUrls,
        ),
      },
      { status: 400 },
    );
  }

  const validUrls: string[] = [];
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (!SUPPORTED_PROTOCOLS.includes(parsed.protocol)) continue;
      // Store the normalized href so downstream logic and safeFetch see a canonical URL
      validUrls.push(parsed.href);
    } catch {
      /* skip invalid URLs */
    }
  }

  if (validUrls.length === 0) {
    return NextResponse.json(
      { error: "No valid URLs provided." },
      { status: 400 },
    );
  }

  // Check daily quota (dailyScans): each URL in the bulk scan counts as 1
  // scan, regardless of auth method. API-key callers used to skip this
  // entirely, bounded only by apiRequestsPerDay below (a different, much
  // broader "total API calls" limit -- unlimited on Elite), which meant an
  // API key had no dailyScans cap on bulk-triggered scans at all. This is
  // a fast-path upper-bound estimate only; the real, race-safe enforcement
  // is the atomic checkAndRecordRequest call inside the loop below.
  const quotaCheck = await canMakeRequest(authedUserId!);
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      {
        error:
          "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
      },
      { status: 429, headers: getRateLimitHeaders(quotaCheck) },
    );
  }

  // How many URLs can we actually run given remaining quota?
  const remaining =
    quotaCheck.limit === -1
      ? validUrls.length
      : Math.min(validUrls.length, quotaCheck.remaining);
  const urlsToScan = validUrls.slice(0, remaining);
  const skipped = validUrls.length - urlsToScan.length;

  // Run scans sequentially to avoid overwhelming resources
  const results: Array<{
    url: string;
    success: boolean;
    scanHistoryId?: number | null;
    error?: string;
    summary?: unknown;
    findings_count?: number;
    duration?: number;
  }> = [];

  // scanner: hard ceiling on the whole batch, admin-configurable via
  // BULK_SCAN_TIMEOUT_SECONDS. Each individual scan already has its own
  // watchdog (SCAN_TIMEOUT_SECONDS, enforced inside executeScan), but a
  // large URL list run sequentially had no overall cap -- a slow target
  // partway through could keep the request running indefinitely.
  const bulkScanTimeoutSeconds = await getSetting("BULK_SCAN_TIMEOUT_SECONDS");
  const bulkDeadline = Date.now() + bulkScanTimeoutSeconds * 1000;

  let lastApiKeyRateLimit: Awaited<
    ReturnType<typeof checkApiKeyRateLimit>
  > | null = null;
  for (let i = 0; i < urlsToScan.length; i++) {
    const scanUrl = urlsToScan[i];
    if (Date.now() >= bulkDeadline) {
      results.push({
        url: scanUrl,
        success: false,
        error: `Bulk scan timed out after ${bulkScanTimeoutSeconds}s. Remaining URLs were not scanned.`,
      });
      continue;
    }
    // Atomic check-and-increment per URL, regardless of auth method -- this,
    // not the upfront canMakeRequest estimate above, is what actually
    // enforces the cap. Closes the TOCTOU race a separate read-then-
    // increment would have against concurrent requests (another bulk call,
    // a single-URL scan, another tab) consuming quota in between.
    const dailyQuota = await checkAndRecordRequest(authedUserId!);
    if (!dailyQuota.allowed) {
      results.push({
        url: scanUrl,
        success: false,
        error:
          "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
      });
      // Push remaining URLs as quota-exceeded too. Uses the loop index (not
      // urlsToScan.indexOf(scanUrl)) because indexOf resolves to the FIRST
      // occurrence of a duplicate URL, not the one currently being
      // processed -- with duplicates in the batch that would re-push
      // already-scanned URLs as quota-exceeded and skip the real remainder.
      for (const remainingUrl of urlsToScan.slice(i + 1)) {
        results.push({
          url: remainingUrl,
          success: false,
          error:
            "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
        });
      }
      break;
    }

    if (
      isApiKeyAuth &&
      apiKeyId !== null &&
      typeof apiKeyDailyLimit === "number"
    ) {
      // Consume one rate-limit slot per URL scanned (prevents 100x amplification
      // where a single bulk call counted as only 1 slot regardless of URL count).
      lastApiKeyRateLimit = await checkApiKeyRateLimit(
        apiKeyId,
        apiKeyDailyLimit,
      );
      if (!lastApiKeyRateLimit.allowed) {
        results.push({
          url: scanUrl,
          success: false,
          error: "API key daily limit reached mid-scan.",
        });
        for (const remainingUrl of urlsToScan.slice(i + 1)) {
          results.push({
            url: remainingUrl,
            success: false,
            error: "API key daily limit reached mid-scan.",
          });
        }
        break;
      }
    }
    const scanResult = await runSingleScan(
      scanUrl,
      authedUserId!,
      isApiKeyAuth,
      requestedIsPublic,
      scanSettings,
    );
    results.push(scanResult);
  }

  // Add skipped URLs as quota-exceeded entries
  for (const scanUrl of validUrls.slice(remaining)) {
    results.push({
      url: scanUrl,
      success: false,
      error:
        "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
    });
  }

  const responseData = {
    total: validUrls.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    skipped,
    results,
  };

  // Add rate limit headers using last per-URL check result (avoids consuming an extra slot)
  if (isApiKeyAuth && lastApiKeyRateLimit) {
    return NextResponse.json(responseData, {
      headers: {
        "X-RateLimit-Limit": String(lastApiKeyRateLimit.limit),
        "X-RateLimit-Remaining": String(lastApiKeyRateLimit.remaining),
        "X-RateLimit-Reset": lastApiKeyRateLimit.resetsAt,
      },
    });
  }
  if (isApiKeyAuth) {
    return NextResponse.json(responseData);
  }

  const finalQuota = await canMakeRequest(authedUserId!);
  return NextResponse.json(responseData, {
    headers: getRateLimitHeaders(finalQuota),
  });
}
