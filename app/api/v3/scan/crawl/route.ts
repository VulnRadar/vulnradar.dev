import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
  recordUsage,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { executeCrawlScan } from "@/lib/scanner/execute-crawl-scan";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { resolveScanIsPublic } from "@/lib/scanner/scan-privacy";

export async function POST(request: NextRequest) {
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

    // scoping: triggering a crawl scan requires scan:write.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
      return NextResponse.json(
        { error: apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE) },
        { status: 403 },
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );

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

    const rl = await checkRateLimit({
      key: `crawl:${session.userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Crawl rate limit reached. Please wait before scanning again.",
        },
        { status: 429 },
      );
    }
  }

  // Both branches above either return early or assign authedUserId; this
  // guard only exists so TypeScript (and executeCrawlScan's signature)
  // can treat it as a plain number from here on.
  if (!authedUserId) {
    return NextResponse.json(
      { error: "Unauthorized. Please sign in to scan." },
      { status: 401 },
    );
  }

  const body = await request.json();
  const url: string = body.url;
  const selectedUrls: string[] | undefined = body.urls;
  const scanners: string[] | null =
    Array.isArray(body.scanners) && body.scanners.length > 0
      ? body.scanners
      : null;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  // scanner: per-URL length cap shared with scan/route.ts.
  const maxUrlLength = await getSetting("MAX_URL_LENGTH");
  if (url.length > maxUrlLength) {
    return NextResponse.json(
      {
        error: `URL exceeds maximum length of ${maxUrlLength} characters.`,
      },
      { status: 400 },
    );
  }
  if (Array.isArray(selectedUrls)) {
    for (const u of selectedUrls) {
      if (typeof u === "string" && u.length > maxUrlLength) {
        return NextResponse.json(
          {
            error: `URL exceeds maximum length of ${maxUrlLength} characters.`,
          },
          { status: 400 },
        );
      }
    }
  }

  let mainUrl: URL;
  try {
    mainUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (mainUrl.protocol !== "http:" && mainUrl.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only http and https URLs are allowed" },
      { status: 400 },
    );
  }

  const normalizedMainUrl = mainUrl.href;

  // Check access rules (blacklist/whitelist) for the main URL
  const accessCheck = await checkAccessRules(normalizedMainUrl);
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

  // Public by default (matches scan_history.is_public's DB default), unless
  // the request explicitly says otherwise, or (when it says nothing) the
  // account's own "scans are private by default" setting says otherwise.
  // Resolved this late so a request rejected above never pays for the
  // account-default lookup. See lib/scanner/scan-jobs.ts's
  // finalizeScanSuccess, the shared completion path for this and
  // scan/route.ts.
  const requestedIsPublic = await resolveScanIsPublic(
    authedUserId,
    typeof body.isPublic === "boolean" ? body.isPublic : undefined,
  );

  // Create the tracker row immediately so there is something to poll. Page
  // discovery and the daily-quota check both depend on work that happens
  // in the background (discovery is itself a multi-fetch crawl), so unlike
  // scan/route.ts, the "categories total" for this row starts at 0 and is
  // filled in once the page count is known — see executeCrawlScan.
  let scanHistoryId: number;
  try {
    const insertResult = await pool.query(
      `INSERT INTO scan_history
         (user_id, url, source, notes, status, started_at, categories_total, is_public)
       VALUES ($1, $2, $3, $4, 'pending', NOW(), 0, $5)
       RETURNING id`,
      [
        authedUserId,
        normalizedMainUrl,
        isApiKeyAuth ? "api" : "web",
        DEFAULT_SCAN_NOTE,
        requestedIsPublic,
      ],
    );
    const insertedId = insertResult.rows[0]?.id;
    if (!insertedId) throw new Error("Insert returned no id");
    scanHistoryId = insertedId;
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to create scan_history row for crawl:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Failed to start the crawl scan. Please try again." },
      { status: 500 },
    );
  }

  // Kick off discovery + scanning detached from this request's lifecycle.
  // Safe here specifically because VulnRadar runs as one persistent Node
  // process, not serverless functions.
  void executeCrawlScan({
    scanId: scanHistoryId,
    normalizedMainUrl,
    mainOrigin: mainUrl.origin,
    selectedUrls,
    scanners,
    authedUserId,
    isApiKeyAuth,
  });

  // Record API key usage against the request that was accepted.
  if (isApiKeyAuth && apiKeyId && typeof apiKeyDailyLimit === "number") {
    await recordUsage(apiKeyId);
    const rateLimit = await checkApiKeyRateLimit(apiKeyId, apiKeyDailyLimit);
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
}
