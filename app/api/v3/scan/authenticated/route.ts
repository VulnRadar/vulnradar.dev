import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
} from "@/lib/api/api-keys";
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
  SCAN_AUTH,
  SCANNING,
  SEVERITY_LEVELS,
} from "@/lib/config/constants";
import { CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH } from "@/lib/config/config-values";
import { getSetting } from "@/lib/config/runtime-config";
import type { Category, Severity, Vulnerability } from "@/lib/scanner/types";
import { runSyncChecks } from "@/lib/scanner/engine";
import { runAsyncChecks } from "@/lib/scanner/async-checks";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";
import { upsertHostReputation } from "@/lib/scanner/host-reputation";
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
 *   }
 *
 * This mirrors the fetch-and-check shape of POST /api/v3/scan for a single
 * page. It intentionally does not crawl.
 */

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const MAX_BODY_SIZE = 1 * 1024 * 1024;
const secretString = z.string().min(1).max(CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH);

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
    .max(SCAN_AUTH.MAX_COOKIES),
});

const AuthSchema = z.discriminatedUnion("method", [
  FormAuthSchema,
  HeaderAuthSchema,
  CookieAuthSchema,
]);

const RequestSchema = z.object({
  url: z.string().url().max(SCANNING.MAX_URL_LENGTH),
  scanners: z.array(z.string()).optional(),
  auth: AuthSchema,
});

function toEphemeralAuth(
  parsed: z.infer<typeof AuthSchema>,
): EphemeralAuthInput {
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
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return ApiResponse.badRequest(
      parsed.error.issues[0]?.message || "Invalid request.",
    );
  }
  const { url, scanners } = parsed.data;
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
  try {
    const response = await safeFetch(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": `${APP_NAME}/1.0 (Security Scanner; Authenticated)`,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      },
      [new URL(url).hostname],
      session,
    );
    responseBody = await readCappedBody(response, MAX_BODY_SIZE);
    headers = response.headers;
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
          source, response_headers, notes, authenticated)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, true)
       RETURNING id`,
      [
        authedUserId,
        url,
        JSON.stringify(summary),
        JSON.stringify(findings),
        summary.total,
        duration,
        isApiKeyAuth ? "api" : "web",
        JSON.stringify(redactedHeaders),
        DEFAULT_SCAN_NOTE,
      ],
    );
    scanHistoryId = insertResult.rows[0]?.id ?? null;
  } catch (err) {
    console.error(
      "[scan/authenticated] Failed to save scan history:",
      err instanceof Error ? err.message : err,
    );
  }

  // Host-level reputation cache for the browser extension's popup.
  // Authenticated scans write scan_history directly instead of going
  // through lib/scanner/scan-jobs.ts's finalizeScanSuccess, so it upserts
  // here too.
  void upsertHostReputation({
    url,
    findings,
    summary,
    scanId: scanHistoryId,
    scannedAt: new Date().toISOString(),
  });

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
