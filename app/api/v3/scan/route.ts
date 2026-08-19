import { NextRequest, NextResponse } from "next/server";
import { getPlannedSyncCategories } from "@/lib/scanner/engine";
import { getPlannedAsyncBranches } from "@/lib/scanner/async-checks";
import {
  executeScan,
  normalizeUrl,
  isRawIpv4,
  isValidUrl,
  getProtocolType,
  VALID_SERVICE_PROBES,
  SERVICE_PROBE_PORTS,
} from "@/lib/scanner/execute-scan";
import { getSession } from "@/lib/auth";
import {
  validateApiKey,
  checkRateLimit,
  recordUsage,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import {
  checkRateLimit as checkGlobalRL,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import {
  checkAndRecordRequest,
  getRateLimitHeaders,
} from "@/lib/rate-limiting/daily-limits";
import pool from "@/lib/database/db";
import type { Category } from "@/lib/scanner/types";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { requestsActiveProbing } from "@/lib/scanner/active-probe-catalog";
import { checkConcurrentScanLimit } from "@/lib/rate-limiting/concurrent-scans";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { resolveScanIsPublic } from "@/lib/scanner/scan-privacy";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { rateLimitedEmail } from "@/lib/email/email";

export async function POST(request: NextRequest) {
  try {
    // Auth: check API key first (Bearer token), then fall back to session cookie
    const authHeader = request.headers.get("authorization");
    let apiKeyId: number | null = null;
    let apiKeyDailyLimit = 50;
    let isApiKeyAuth = false;
    let authedUserId: number | null = null;
    let keyData: Awaited<ReturnType<typeof validateApiKey>> | null = null;

    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const token = authHeader.slice(7);
      keyData = await validateApiKey(token);

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

      // scoping: triggering a scan requires scan:write.
      if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
        return NextResponse.json(
          { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
          { status: 403 },
        );
      }

      // Check rate limit
      const rateLimit = await checkRateLimit(keyData.keyId, keyData.dailyLimit);

      if (!rateLimit.allowed) {
        // Notify: this key just got rate-limited. Best-effort/fire-and-
        // forget, wrapped as a single async IIFE (not awaited) so that even
        // getClientIp/getUserAgent failing can never turn this 429 into a
        // 500. Gated by api_usage_alerts (email_api_limit_warning), so a
        // caller that hammers past its limit repeatedly can turn this off
        // rather than being flooded with one email per rejected request.
        (async () => {
          const rateLimitIp = await getClientIp();
          await sendNotificationEmail({
            userId: keyData.userId,
            userEmail: keyData.email,
            type: "api_usage_alerts",
            emailContent: rateLimitedEmail(rateLimitIp, {
              ipAddress: rateLimitIp,
              userAgent: await getUserAgent(),
            }),
          });
        })().catch((err) =>
          console.error(
            `[${APP_NAME}] Failed to send rate-limit notification:`,
            err,
          ),
        );

        return NextResponse.json(
          {
            error: "Rate limit exceeded. 50 requests per 24 hours.",
            limit: rateLimit.limit,
            used: rateLimit.used,
            remaining: rateLimit.remaining,
            resets_at: rateLimit.resetsAt,
          },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": String(rateLimit.limit),
              "X-RateLimit-Remaining": String(rateLimit.remaining),
              "X-RateLimit-Reset": rateLimit.resetsAt,
              "Retry-After": String(
                Math.ceil(
                  (new Date(rateLimit.resetsAt).getTime() - Date.now()) / 1000,
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

      // Rate limit web scans by user (burst protection)
      const rl = await checkGlobalRL({
        key: `scan:${session.userId}`,
        ...RATE_LIMITS.scan,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          {
            error: `Scan rate limit reached. Please wait before scanning again.`,
          },
          { status: 429 },
        );
      }
    }

    // Both branches above either return early or assign authedUserId; this
    // guard only exists so TypeScript (and executeScan's signature) can
    // treat it as a plain number from here on.
    if (!authedUserId) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to scan." },
        { status: 401 },
      );
    }

    // Daily scan quota, based on subscription plan (dailyScans) -- distinct
    // from the API key's own dailyLimit/rate limit above (apiRequestsPerDay,
    // a broader "total API calls" throttle, not "scans triggered"). Applies
    // uniformly to both auth paths: this used to run only inside the
    // session-cookie branch, which meant an API-key caller's scan creation
    // was bounded only by apiRequestsPerDay -- unlimited on Elite
    // (apiRequestsPerDay: -1) even though dailyScans is a real, finite cap
    // (500) at every tier.
    const dailyQuota = await checkAndRecordRequest(authedUserId);
    if (!dailyQuota.allowed) {
      return NextResponse.json(
        {
          error:
            "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.",
          limit: dailyQuota.limit,
          used: dailyQuota.used,
          remaining: 0,
          resets_at: dailyQuota.resetsAt,
        },
        {
          status: 429,
          headers: getRateLimitHeaders(dailyQuota),
        },
      );
    }

    // Capacity, not demand-shaping: VulnRadar runs as one persistent
    // process with no job queue, so every 'pending'/'running' scan shares
    // that process's resources with everyone else's. See
    // lib/rate-limiting/concurrent-scans.ts.
    const concurrency = await checkConcurrentScanLimit(authedUserId);
    if (!concurrency.allowed) {
      return NextResponse.json(
        { error: concurrency.message, statusCode: "CONCURRENT_SCAN_LIMIT" },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { url, scanners, probes, isPublic } = body;
    // Opt-in page screenshot (see ExecuteScanParams.captureScreenshot). Only
    // ever true when the caller explicitly asked for it; a screenshot spins
    // up a real, metered BrowserBase session, so it is never implied.
    const captureScreenshot = body.captureScreenshot === true;
    // Opt-in curated port/service sweep (see ExecuteScanParams.portScan).
    // Off unless explicitly requested. Port-scanning from a shared server is
    // abuse, so this is held to the SAME verified-domain-ownership gate active
    // probing uses, enforced below.
    const portScan = body.portScan === true;
    const selectedScanners: string[] | null =
      Array.isArray(scanners) && scanners.length > 0 ? scanners : null;
    const requestedProbes: Array<{ service: string; port: number }> =
      Array.isArray(probes)
        ? probes
            .map((p: unknown) => {
              if (typeof p === "string") {
                const [idPart, portPart] = p.split(":");
                const service = idPart;
                if (!VALID_SERVICE_PROBES.has(service)) return null;
                const port = portPart
                  ? parseInt(portPart, 10)
                  : SERVICE_PROBE_PORTS[service];
                if (!Number.isFinite(port) || port < 1 || port > 65535)
                  return null;
                return { service, port };
              }
              if (
                p &&
                typeof p === "object" &&
                "id" in (p as Record<string, unknown>) &&
                typeof (p as Record<string, unknown>).id === "string" &&
                VALID_SERVICE_PROBES.has(
                  (p as Record<string, unknown>).id as string,
                )
              ) {
                const obj = p as { id: string; port?: number };
                const port =
                  typeof obj.port === "number" &&
                  obj.port >= 1 &&
                  obj.port <= 65535
                    ? obj.port
                    : SERVICE_PROBE_PORTS[obj.id];
                return { service: obj.id, port };
              }
              return null;
            })
            .filter((p): p is { service: string; port: number } => p !== null)
        : [];

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // api: enforce URL length cap at the API boundary. The
    // MAX_URL_LENGTH setting is enforced here so a 50 MB
    // URL string is rejected before any DNS resolution or DB write
    // occurs. See lib/config/config-values.ts.
    const maxUrlLength = await getSetting("MAX_URL_LENGTH");
    if (url.length > maxUrlLength) {
      return NextResponse.json(
        {
          error: `URL exceeds maximum length of ${maxUrlLength} characters.`,
        },
        { status: 400 },
      );
    }

    const normalizedUrl = normalizeUrl(url);

    if (!isValidUrl(normalizedUrl)) {
      return NextResponse.json(
        {
          error:
            "Invalid URL. Supported protocols: http://, https://, ws://, wss://, ftp://, ftps://",
        },
        { status: 400 },
      );
    }

    // SSRF protection - validate target is not internal/private
    const safetyCheck = await validateScanTarget(normalizedUrl);
    if (!safetyCheck.safe) {
      return NextResponse.json(
        { error: safetyCheck.reason || "URL blocked for security reasons" },
        { status: 400 },
      );
    }

    // Check access rules (blacklist/whitelist)
    const accessCheck = await checkAccessRules(normalizedUrl);
    if (!accessCheck.allowed) {
      return NextResponse.json(
        {
          error: "This target cannot be scanned.",
          details:
            "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data. If you believe this is an error, please contact support.",
          statusCode: "BLOCKED",
        },
        { status: 403 },
      );
    }

    // Domain ownership: active-probes submits real exploit-attempt
    // payloads (SQLi/XSS/SSTI canaries, a live GraphQL introspection
    // query) to the target instead of only reading responses -- it must
    // never run against a URL the caller hasn't proven control over (see
    // lib/domains/scope.ts). This is a authorization gate, separate from
    // (and in addition to) the SSRF/access-rules safety checks above,
    // which apply regardless of which categories are requested.
    // A curated port sweep (portScan) is held to the exact same gate: it makes
    // this server a scan source against the target, so the caller must own the
    // domain. One ownership check covers both intrusive capabilities; the `||`
    // short-circuits so an ordinary scan (no active probes, no port scan) never
    // pays for the DB lookup at all.
    const wantsActiveProbing = requestsActiveProbing(selectedScanners);
    if (
      (wantsActiveProbing || portScan) &&
      !(await isUrlOwnedByUser(normalizedUrl, authedUserId))
    ) {
      return NextResponse.json(
        {
          error: wantsActiveProbing
            ? "Active probing requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before requesting active-probes."
            : "Port scanning requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before requesting a port scan.",
          statusCode: "DOMAIN_NOT_VERIFIED",
        },
        { status: 403 },
      );
    }

    const protocolType = getProtocolType(normalizedUrl);
    const isRawIpTarget = isRawIpv4(url) || isRawIpv4(normalizedUrl);

    // Progress denominator, computed from exactly what will run — never
    // estimated. Raw IP targets skip the sync engine entirely (HTTP-context
    // checks don't apply), matching executeScan's own gating below.
    const plannedSync = isRawIpTarget
      ? []
      : getPlannedSyncCategories(selectedScanners as Category[] | null);
    const plannedAsync = getPlannedAsyncBranches(
      normalizedUrl,
      selectedScanners,
    );
    const categoriesTotal =
      plannedSync.length + plannedAsync.length + requestedProbes.length;

    // Public unless the request explicitly says otherwise, or (when it
    // says nothing) the account's own "scans are private by default"
    // setting says otherwise. Resolved this late so a request that gets
    // rejected above (bad URL, SSRF, access rules) never pays for the
    // account-default lookup. See lib/scanner/scan-jobs.ts's
    // finalizeScanSuccess, which skips upsertHostReputation for a scan
    // whose is_public ends up false here.
    const requestedIsPublic = await resolveScanIsPublic(
      authedUserId,
      typeof isPublic === "boolean" ? isPublic : undefined,
    );

    // Create the scan_history row immediately so there is something to
    // poll. This now happens BEFORE any scanning: without a row, there is
    // nowhere to report progress or a result, so a failure here is fatal
    // to the request (unlike before, when the row was best-effort because
    // the client already had the full result in hand either way).
    let scanHistoryId: number;
    try {
      const insertResult = await pool.query(
        `INSERT INTO scan_history
           (user_id, url, source, notes, status, started_at, categories_total, is_public)
         VALUES ($1, $2, $3, $4, 'pending', NOW(), $5, $6)
         RETURNING id`,
        [
          authedUserId,
          normalizedUrl,
          isApiKeyAuth ? "api" : "web",
          DEFAULT_SCAN_NOTE,
          categoriesTotal,
          requestedIsPublic,
        ],
      );
      const insertedId = insertResult.rows[0]?.id;
      if (!insertedId) throw new Error("Insert returned no id");
      scanHistoryId = insertedId;
    } catch (err) {
      console.error(
        `[${APP_NAME}] Failed to create scan_history row:`,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json(
        { error: "Failed to start the scan. Please try again." },
        { status: 500 },
      );
    }

    // Kick off the real work detached from this request's lifecycle. Safe
    // here specifically because VulnRadar runs as one persistent Node
    // process (not serverless functions): the function keeps running after
    // this handler returns, with no risk of being killed mid-scan the way
    // it would be on a Vercel-style deployment.
    void executeScan({
      scanId: scanHistoryId,
      url,
      normalizedUrl,
      protocolType,
      isRawIpTarget,
      selectedScanners,
      requestedProbes,
      authedUserId,
      categoriesTotal,
      captureScreenshot,
      portScan,
    });

    // Record API key usage and add rate limit headers against the request
    // that was accepted, not the eventual result — the two are now
    // decoupled in time.
    if (isApiKeyAuth && apiKeyId) {
      await recordUsage(apiKeyId);
      const rateLimit = await checkRateLimit(apiKeyId, apiKeyDailyLimit);
      return NextResponse.json(
        { scanId: scanHistoryId, status: "running" },
        {
          headers: {
            "X-RateLimit-Limit": String(rateLimit.limit),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": rateLimit.resetsAt,
          },
        },
      );
    }

    return NextResponse.json({ scanId: scanHistoryId, status: "running" });
  } catch (error) {
    console.error(
      `[${APP_NAME}] Scan error:`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "An unexpected error occurred during the scan." },
      { status: 500 },
    );
  }
}
