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
import { checkAccessRules } from "@/lib/scanner/access-rules";

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

      // Check rate limit
      const rateLimit = await checkRateLimit(keyData.keyId, keyData.dailyLimit);

      if (!rateLimit.allowed) {
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

      // Check daily quota based on subscription plan
      const dailyQuota = await checkAndRecordRequest(session.userId);
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

    const body = await request.json();
    const { url, scanners, probes } = body;
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
    const categoriesTotal = plannedSync.length + plannedAsync.length;

    // Create the scan_history row immediately so there is something to
    // poll. This now happens BEFORE any scanning: without a row, there is
    // nowhere to report progress or a result, so a failure here is fatal
    // to the request (unlike before, when the row was best-effort because
    // the client already had the full result in hand either way).
    let scanHistoryId: number;
    try {
      const insertResult = await pool.query(
        `INSERT INTO scan_history
           (user_id, url, source, notes, status, started_at, categories_total)
         VALUES ($1, $2, $3, $4, 'pending', NOW(), $5)
         RETURNING id`,
        [
          authedUserId,
          normalizedUrl,
          isApiKeyAuth ? "api" : "web",
          DEFAULT_SCAN_NOTE,
          categoriesTotal,
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
