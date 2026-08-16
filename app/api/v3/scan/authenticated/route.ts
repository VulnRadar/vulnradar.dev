import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import {
  checkRateLimit as checkGlobalRateLimit,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import { checkAndRecordRequest } from "@/lib/rate-limiting/daily-limits";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { logAction } from "@/lib/auth/authorization";
import pool from "@/lib/database/db";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
  ERROR_MESSAGES,
  SEVERITY_LEVELS,
  SEVERITY_PRIORITY,
} from "@/lib/config/constants";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import type { Category, Vulnerability } from "@/lib/scanner/types";
import { runSyncChecks } from "@/lib/scanner/engine";
import { runAsyncChecks } from "@/lib/scanner/async-checks";
import { normalizeUrl } from "@/lib/scanner/execute-scan";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";
import { upsertHostReputation } from "@/lib/scanner/host-reputation";
import { saveAutoTags, maybeSuggestAiTag } from "@/lib/tags/auto-tags";
import { establishScanSession, readCappedBody } from "@/lib/scanner/auth/login";
import type {
  EphemeralAuthInput,
  ScanAuthReport,
} from "@/lib/scanner/auth/types";

/**
 * POST /api/v3/scan/authenticated
 *
 * Fully ephemeral authenticated scanning. Login material travels in the
 * request body of a single call and lives only in memory for the length of
 * that call: it is never written to a table, a log line, or an audit
 * record, and it never appears in the response or in an error message.
 * `logAction` below records only the non-secret fact that an authenticated
 * scan ran and how it turned out, matching how the material itself never
 * appears in `ScanAuthReport`'s `reason` strings either (see
 * lib/scanner/auth/login.ts and lib/scanner/auth/browser-login.ts).
 *
 * A login that fails, or that cannot be confirmed, aborts before any scan
 * runs: the response's `authReport.status` is "failed" and no scan_history
 * row is written, because a scan of the signed-out site is not what the
 * caller asked for.
 *
 * Request body:
 *   {
 *     url: string;
 *     scanners?: string[];
 *     auth: {
 *       method: "form" | "header" | "cookie";
 *       // form: opens a real browser session to render the login page
 *       // (see lib/scanner/auth/browser-login.ts), so a JS-rendered login
 *       // form gets a chance to appear before the scanner looks for it.
 *       username?: string; password?: string;
 *       loginUrl?: string; usernameField?: string; passwordField?: string;
 *       // header:
 *       headerName?: string; headerValue?: string;
 *       // cookie:
 *       cookies?: Array<{ name: string; value: string }>;
 *     };
 *     // Publishes this scan to host_reputation / the public
 *     // /host/[hostname] page only when explicitly `true`. Unlike
 *     // POST /api/v3/scan and /scan/crawl, omitting this field (or
 *     // sending `false`) always keeps an authenticated scan private,
 *     // regardless of the account's "scans are private by default"
 *     // setting -- see the requestedIsPublic comment below.
 *     isPublic?: boolean;
 *   }
 *
 * This mirrors the fetch-and-check shape of POST /api/v3/scan for a single
 * page. It intentionally does not crawl.
 */

/**
 * The request schema depends on three admin-configurable settings
 * (SCAN_AUTH_MAX_SECRET_LENGTH, SCAN_AUTH_MAX_COOKIES, MAX_URL_LENGTH), so it
 * can't be a module-level constant built once at import time with the
 * compiled defaults baked in -- that would make an admin edit permanently
 * inert until the next deploy. Rebuilt per request from the live resolved
 * values instead; Zod schema construction is cheap enough that this costs
 * nothing meaningful per call.
 */
function buildRequestSchema(opts: {
  maxSecretLength: number;
  maxCookies: number;
  maxUrlLength: number;
}) {
  const secretString = z.string().min(1).max(opts.maxSecretLength);

  const FormAuthSchema = z.object({
    method: z.literal("form"),
    username: secretString,
    password: secretString,
    loginUrl: z.string().url().max(2048).optional(),
    usernameField: z.string().max(200).optional(),
    passwordField: z.string().max(200).optional(),
  });

  const HeaderAuthSchema = z.object({
    method: z.literal("header"),
    headerName: z.string().max(200).optional(),
    headerValue: secretString,
  });

  const CookieAuthSchema = z.object({
    method: z.literal("cookie"),
    cookies: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          value: secretString,
        }),
      )
      .min(1)
      .max(opts.maxCookies),
  });

  const AuthSchema = z.discriminatedUnion("method", [
    FormAuthSchema,
    HeaderAuthSchema,
    CookieAuthSchema,
  ]);

  return z.object({
    url: z.string().url().max(opts.maxUrlLength),
    scanners: z.array(z.string()).optional(),
    auth: AuthSchema,
    // Private unless the caller explicitly opts in with `true`. See the
    // requestedIsPublic comment below for why this is the one scan-creation
    // path that does NOT fall back to scan_history.is_public's normal true
    // default or the account-level "scans are private by default" setting.
    isPublic: z.boolean().optional(),
  });
}

type RequestSchemaType = ReturnType<typeof buildRequestSchema>;
type AuthSchemaInput = z.infer<RequestSchemaType>["auth"];

function toEphemeralAuth(parsed: AuthSchemaInput): EphemeralAuthInput {
  switch (parsed.method) {
    case "form":
      return {
        method: "form",
        username: parsed.username,
        password: parsed.password,
        loginUrl: parsed.loginUrl,
        usernameField: parsed.usernameField,
        passwordField: parsed.passwordField,
      };
    case "header":
      return {
        method: "header",
        headerName: parsed.headerName,
        headerValue: parsed.headerValue,
      };
    case "cookie":
      return { method: "cookie", cookies: parsed.cookies };
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const scanAuthEnabled = await getSetting("SCAN_AUTH_ENABLED");
  if (!scanAuthEnabled) {
    return ApiResponse.forbidden(
      "Authenticated scanning is disabled on this deployment.",
    );
  }

  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let isApiKeyAuth = false;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(BEARER_PREFIX.length);
    const keyData = await validateApiKey(token);
    if (!keyData)
      return ApiResponse.unauthorized("Invalid or revoked API key.");
    if (keyData.needsTermsAcceptance) {
      return ApiResponse.forbidden(
        "Please accept our updated Terms of Service before using the API.",
      );
    }
    // scoping: triggering an authenticated scan requires scan:write.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_WRITE)) {
      return ApiResponse.forbidden(
        apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_WRITE),
      );
    }
    const keyRate = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!keyRate.allowed) {
      return ApiResponse.tooManyRequests(
        "Rate limit exceeded.",
        Math.ceil((new Date(keyRate.resetsAt).getTime() - Date.now()) / 1000),
      );
    }
    authedUserId = keyData.userId;
    isApiKeyAuth = true;
  } else {
    const session = await getSession();
    if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    authedUserId = session.userId;

    const rl = await checkGlobalRateLimit({
      key: `scan-authenticated:${session.userId}`,
      ...RATE_LIMITS.scan,
    });
    if (!rl.allowed) {
      return ApiResponse.tooManyRequests(
        "Scan rate limit reached. Please wait before scanning again.",
      );
    }

    const dailyQuota = await checkAndRecordRequest(session.userId);
    if (!dailyQuota.allowed) {
      return ApiResponse.tooManyRequests(
        "Daily scan limit reached. Upgrade your plan or wait until midnight UTC.",
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return ApiResponse.badRequest("Invalid JSON.");
  }
  // Every other scan-creation route (POST /api/v3/scan, /scan/crawl) accepts
  // a bare "example.com" and prepends https:// via normalizeUrl before
  // validating -- the scan form's own URL field makes that promise
  // regardless of whether a login was attached. This route used to validate
  // the raw body.url straight through z.string().url(), which requires a
  // scheme, so the exact same input that works for an unauthenticated scan
  // failed here with Zod's generic "Invalid input" and no indication why.
  if (
    body &&
    typeof body === "object" &&
    "url" in body &&
    typeof (body as Record<string, unknown>).url === "string"
  ) {
    (body as Record<string, unknown>).url = normalizeUrl(
      (body as Record<string, unknown>).url as string,
    );
  }
  // Same gap, same fix, for the optional form-auth loginUrl sub-field --
  // it hits the identical z.string().url() check a couple lines down.
  if (body && typeof body === "object" && "auth" in body) {
    const authBody = (body as Record<string, unknown>).auth;
    if (
      authBody &&
      typeof authBody === "object" &&
      "loginUrl" in authBody &&
      typeof (authBody as Record<string, unknown>).loginUrl === "string" &&
      (authBody as Record<string, unknown>).loginUrl !== ""
    ) {
      (authBody as Record<string, unknown>).loginUrl = normalizeUrl(
        (authBody as Record<string, unknown>).loginUrl as string,
      );
    }
  }
  const {
    SCAN_AUTH_MAX_SECRET_LENGTH: maxSecretLength,
    SCAN_AUTH_MAX_COOKIES: maxCookies,
    MAX_URL_LENGTH: maxUrlLength,
    SCAN_FETCH_TIMEOUT_MS: fetchTimeoutMs,
    SCAN_ASYNC_CHECKS_TIMEOUT_MS: asyncChecksTimeoutMs,
    SCAN_RESPONSE_BODY_MAX_BYTES: MAX_BODY_SIZE,
  } = await getSettings([
    "SCAN_AUTH_MAX_SECRET_LENGTH",
    "SCAN_AUTH_MAX_COOKIES",
    "MAX_URL_LENGTH",
    "SCAN_FETCH_TIMEOUT_MS",
    "SCAN_ASYNC_CHECKS_TIMEOUT_MS",
    "SCAN_RESPONSE_BODY_MAX_BYTES",
  ] as const);
  const RequestSchema = buildRequestSchema({
    maxSecretLength,
    maxCookies,
    maxUrlLength,
  });
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return ApiResponse.badRequest(
      parsed.error.issues[0]?.message || "Invalid request.",
    );
  }
  const { url, scanners } = parsed.data;
  // Authenticated scans see whatever a logged-in area of the target site
  // renders -- account settings, billing details, internal dashboards,
  // anything behind the login this request just performed. That is a
  // strictly more sensitive default than any logged-out scan of the same
  // URL could ever capture, so this endpoint does not inherit either of
  // the other two scan-creation paths' defaults: not scan_history.is_public's
  // own "true unless told otherwise" default, and not the account-level
  // "scans are private by default" setting (lib/scanner/scan-privacy.ts),
  // which a user may have left off precisely because their ordinary,
  // logged-out scans are fine to publish. An authenticated scan always
  // requires an explicit `isPublic: true` on this one request before it
  // reaches host_reputation and the public /host/[hostname] page --
  // never a default, from either direction.
  const requestedIsPublic = parsed.data.isPublic === true;
  // Credential material lives only in this local variable for the rest of
  // the request. It is never assigned anywhere that outlives this handler:
  // not a module-level variable, not a cache, not a return value.
  const auth = toEphemeralAuth(parsed.data.auth);

  const safety = await validateScanTarget(url);
  if (!safety.safe) {
    return ApiResponse.badRequest(
      safety.reason || "URL blocked for security reasons.",
    );
  }
  const access = await checkAccessRules(url);
  if (!access.allowed) {
    return ApiResponse.forbidden("This target cannot be scanned.");
  }

  // Domain ownership: same gate as POST /api/v3/scan -- see that route's
  // own comment for why active-probes needs this and the others don't.
  // Checked before establishScanSession below runs, since an unverified
  // target should never even get a login attempt for this purpose.
  if (
    scanners?.includes("active-probes") &&
    authedUserId !== null &&
    !(await isUrlOwnedByUser(url, authedUserId))
  ) {
    return NextResponse.json(
      {
        error:
          "Active probing requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before requesting active-probes.",
        statusCode: "DOMAIN_NOT_VERIFIED",
      },
      { status: 403 },
    );
  }

  const loginResult = await establishScanSession(auth, url);
  if (!loginResult.ok) {
    const authReport: ScanAuthReport = {
      status: "failed",
      method: auth.method,
      reason: loginResult.reason,
    };
    return NextResponse.json(
      {
        error: `Authenticated scan aborted: ${loginResult.reason}`,
        status: 422,
        authReport,
      },
      { status: 422 },
    );
  }
  const session = loginResult.session;

  const startTime = Date.now();
  let responseBody = "";
  let headers = new Headers();
  let finalScanUrl = url;
  try {
    const response = await safeFetch(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": `${APP_NAME}/1.0 (Security Scanner; Authenticated)`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(fetchTimeoutMs),
      },
      [new URL(url).hostname],
      session,
    );
    responseBody = await readCappedBody(response, MAX_BODY_SIZE);
    headers = response.headers;
    // safeFetch restricts any redirect it follows to the same host (see its
    // own comment), so this is never a different site -- only a different
    // path/query on the one that was requested. Recorded separately from
    // `url` so every check below keeps running against the URL that was
    // actually requested; only scan_history's stored identity changes.
    if (response.url && response.url !== url) {
      finalScanUrl = response.url;
    }
  } catch (fetchError) {
    const message =
      fetchError instanceof Error ? fetchError.message : "Unknown error";
    return ApiResponse.error(
      `Could not reach the target URL while authenticated: ${message}`,
      502,
    );
  }

  const bodyForChecks =
    responseBody.length > 1_000_000
      ? responseBody.slice(0, 1_000_000)
      : responseBody;

  // Same engine the unauthenticated scan routes use, so an authenticated
  // scan gets the same PageCheck coverage (JWT inspection, CSP/XFO
  // contradictions, form security, etc.) instead of only the legacy
  // header/body checks. This matters more here, not less: the whole point
  // of authenticating is to see the page a logged-out scan can't reach.
  const syncResult = runSyncChecks(
    url,
    headers,
    bodyForChecks,
    (scanners as Category[] | undefined) ?? null,
  );
  const syncFindings: Vulnerability[] = syncResult.findings;

  let asyncFindings: Vulnerability[] = [];
  try {
    asyncFindings = await Promise.race([
      runAsyncChecks(url, scanners ?? null),
      new Promise<Vulnerability[]>((resolve) =>
        setTimeout(() => resolve([]), asyncChecksTimeoutMs),
      ),
    ]);
  } catch {
    /* non-fatal */
  }

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

  const duration = Date.now() - startTime;
  const capturedHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    capturedHeaders[key] = value;
  });
  const redactedHeaders = redactSensitiveResponseHeaders(capturedHeaders);

  const authReport: ScanAuthReport = {
    status: session.lost ? "lost" : "authenticated",
    method: auth.method,
    reason: session.lost ? (session.reason ?? undefined) : undefined,
  };

  let scanHistoryId: number | null = null;
  try {
    // Never a credential_id column, never any credential material: only
    // the boolean fact that this scan ran authenticated.
    const insertResult = await pool.query(
      `INSERT INTO scan_history
         (user_id, url, summary, findings, findings_count, duration, scanned_at,
          source, response_headers, notes, authenticated, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, true, $10)
       RETURNING id`,
      [
        authedUserId,
        finalScanUrl,
        JSON.stringify(summary),
        JSON.stringify(findings),
        summary.total,
        duration,
        isApiKeyAuth ? "api" : "web",
        JSON.stringify(redactedHeaders),
        DEFAULT_SCAN_NOTE,
        requestedIsPublic,
      ],
    );
    scanHistoryId = insertResult.rows[0]?.id ?? null;
  } catch (err) {
    console.error(
      "[scan/authenticated] Failed to save scan history:",
      err instanceof Error ? err.message : err,
    );
  }

  // Host-level reputation cache for the browser extension's popup and the
  // public /host/[hostname] page. Authenticated scans write scan_history
  // directly instead of going through lib/scanner/scan-jobs.ts's
  // finalizeScanSuccess, so it upserts here too -- skipped for a scan the
  // caller asked to keep private (scan_history.is_public).
  if (requestedIsPublic) {
    void upsertHostReputation({
      url: finalScanUrl,
      findings,
      summary,
      responseHeaders: redactedHeaders,
      scanId: scanHistoryId,
      scannedAt: new Date().toISOString(),
    });
  }

  // Auto tags (lib/tags/auto-tags.ts): unlike host_reputation above, not
  // gated on requestedIsPublic -- they're personal to the user's own scan
  // record, not the public reputation cache, so a private authenticated
  // scan still gets tagged. Fire-and-forget: never blocks or fails the
  // scan response, matching upsertHostReputation's own contract. Chained
  // (not a second independent `void` call) so maybeSuggestAiTag only fires
  // once saveAutoTags' own INSERT has resolved -- by then this route's
  // scan_history row (written whole, in one INSERT, no pending/running
  // status flip) is already committed, so it's always safe to fire right
  // after. See maybeSuggestAiTag's own comment for why that ordering
  // matters for the job-based scan/crawl routes too.
  if (scanHistoryId) {
    const savedScanId = scanHistoryId;
    void saveAutoTags(savedScanId, authedUserId, findings).then((tags) => {
      void maybeSuggestAiTag(savedScanId, authedUserId, tags, findings);
    });
  }

  // Audit the fact that an authenticated scan ran, never the credential
  // used to achieve it: no username, no password, no header value, no
  // cookie value ever reaches this string.
  await logAction(
    authedUserId,
    authedUserId,
    "scan.authenticated",
    `Ran an authenticated scan of ${new URL(url).origin} (${auth.method} auth, result: ${authReport.status}).`,
  );

  return ApiResponse.success({
    scanHistoryId,
    url,
    scannedAt: new Date().toISOString(),
    duration,
    findings,
    summary,
    responseHeaders: redactedHeaders,
    authReport,
  });
});
