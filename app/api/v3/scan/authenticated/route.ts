import { NextRequest, NextResponse } from "next/server";
import {
  burstLimitedResponse,
  concurrentScanLimitResponse,
  rateLimitedResponse,
  type ApiKeyRateLimitState,
} from "@/lib/api/rate-limit-response";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { checkRateLimit as checkApiKeyRateLimit } from "@/lib/api/api-keys";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { versioned } from "@/lib/api/v4/wrap";
import { currentRequestId } from "@/lib/database/request-context";
import {
  checkTargetScanLimit,
  targetScanLimitMessage,
} from "@/lib/rate-limiting/target-limits";
import {
  checkRateLimit as checkGlobalRateLimit,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import {
  canMakeRequest,
  incrementDailyCountCapped,
} from "@/lib/rate-limiting/daily-limits";
import { withInlineScanSlot } from "@/lib/rate-limiting/concurrent-scans";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { logAction } from "@/lib/auth/authorization";
import {
  resolveNewScanTeamIds,
  attachNewScanTeams,
} from "@/lib/teams/scan-teams";
import pool from "@/lib/database/db";
import {
  DEFAULT_SCAN_NOTE,
  ERROR_MESSAGES,
  SEVERITY_PRIORITY,
} from "@/lib/config/constants";
import { summarizeFindings } from "@/lib/scanner/severity-summary";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import type { Category, Vulnerability } from "@/lib/scanner/types";
import {
  getDangerScore,
  getEngineConfidence,
} from "@/lib/scanner/safety-rating";
import {
  PAGE_CHECKS_INCOMPLETE,
  dedupeScanFindings,
  noPageChecks,
  runSyncChecksYielding,
} from "@/lib/scanner/engine";
import { BOT_CHALLENGE_INCOMPLETE } from "@/lib/scanner/bot-challenge";
import { detectUnusablePage } from "@/lib/scanner/response-classifier";
import { SCANNER_UA_AUTHENTICATED } from "@/lib/scanner/user-agent";
import { startAsyncPhase } from "@/lib/scanner/async-phase";
import { normalizeUrl } from "@/lib/scanner/execute-scan";
import { validateScanTarget, safeFetch } from "@/lib/scanner/safe-fetch";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { requestsActiveProbing } from "@/lib/scanner/active-probe-catalog";
import { parseScannerSelection } from "@/lib/scanner/scanner-selection";
import { redactSensitiveResponseHeaders } from "@/lib/scanner/response-headers";
import { upsertHostReputation } from "@/lib/scanner/host-reputation";
import { saveAutoTags, maybeSuggestAiTag } from "@/lib/tags/auto-tags";
import { establishScanSession, readCappedBody } from "@/lib/scanner/auth/login";
import {
  buildAuthRequestSchema,
  toEphemeralAuth,
} from "@/lib/scanner/auth/request-schema";
import type { ScanAuthReport } from "@/lib/scanner/auth/types";
import { scanningPausedResponse } from "@/lib/admin/service-state";
import { notifyScanComplete } from "@/lib/webhooks/scan-notifications";

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
const DAILY_LIMIT_MESSAGE =
  "Daily scan limit reached. Upgrade your plan or wait until midnight UTC.";

/**
 * The 429 for a spent daily scan quota. This answered with
 * ApiResponse.tooManyRequests, which sends neither Retry-After nor any
 * X-RateLimit-* header and no quota numbers, while every sibling scan route
 * answered the same quota with all of them. rateLimitedResponse supplies
 * those; `status` and `requestId` are added back because the old body carried
 * them, and a v3 body only gains keys.
 */
async function dailyLimitResponse(
  quota: ApiKeyRateLimitState,
): Promise<NextResponse> {
  const base = rateLimitedResponse(quota, DAILY_LIMIT_MESSAGE, {
    code: "DAILY_LIMIT",
  });
  return NextResponse.json(
    {
      ...(await base.json()),
      status: 429,
      requestId: currentRequestId() ?? undefined,
    },
    { status: base.status, headers: base.headers },
  );
}

function buildRequestSchema(opts: {
  maxSecretLength: number;
  maxCookies: number;
  maxUrlLength: number;
}) {
  return z.object({
    url: z.string().url().max(opts.maxUrlLength),
    scanners: z.array(z.string()).optional(),
    // Shared with POST /api/v3/scan/crawl via buildAuthRequestSchema, so both
    // authenticated scan paths accept the identical `auth` block held to the
    // same admin-configurable limits.
    auth: buildAuthRequestSchema({
      maxSecretLength: opts.maxSecretLength,
      maxCookies: opts.maxCookies,
    }),
    // Private unless the caller explicitly opts in with `true`. See the
    // requestedIsPublic comment below for why this is the one scan-creation
    // path that does NOT fall back to scan_history.is_public's normal true
    // default or the account-level "scans are private by default" setting.
    isPublic: z.boolean().optional(),
    // Optional teams to share the resulting scan with. Omitted (or empty)
    // means a personal scan, which is what every scan-creation path used to
    // produce unconditionally: none of them wrote scan_history.team_id, so
    // no team could ever see a member's scans. Validated against the
    // caller's own assignable teams below, never trusted.
    //
    // teamId is the original single-valued form and still works; teamIds is
    // the multi-team form. Sending both is rejected in resolveNewScanTeamIds.
    teamId: z.number().int().positive().nullable().optional(),
    teamIds: z.array(z.number().int().positive()).optional(),
  });
}

async function createAuthenticatedScan(
  request: NextRequest,
): Promise<NextResponse> {
  // PAUSE_SCANNING (and MAINTENANCE_MODE, which implies it). This route runs
  // its whole pipeline inline and never calls into lib/scanner/execute-scan.ts,
  // so a gate placed in the executor would miss it entirely: it needs its own.
  const paused = await scanningPausedResponse();
  if (paused) return paused;

  const scanAuthEnabled = await getSetting("SCAN_AUTH_ENABLED");
  if (!scanAuthEnabled) {
    return ApiResponse.forbidden(
      "Authenticated scanning is disabled on this deployment.",
    );
  }

  let authedUserId: number | null = null;
  let isApiKeyAuth = false;
  // Set in the session branch when the read-only daily-quota gate passes; the
  // counter is CHARGED only after the auth session is established below, so a
  // request rejected before then (login failure 422, invalid target) never
  // burns a scan from the daily allowance.
  let chargeDailyQuota = false;
  let dailyQuotaLimit = -1;

  if (parseBearer(request.headers.get("authorization")) !== null) {
    // Validity, the Terms gate and scan:write, in the one shared order.
    const keyAuth = await authenticateApiKey(request, {
      scope: API_KEY_SCOPES.SCAN_WRITE,
    });
    if (!keyAuth.ok) return keyAuth.response;
    const keyData = keyAuth.auth;
    const keyRate = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!keyRate.allowed) {
      // Was ApiResponse.tooManyRequests, which sends Retry-After but none of
      // the X-RateLimit-* headers and a body with no quota numbers in it. Every
      // sibling scan endpoint answered the same limiter differently.
      // ref: AUDIT-015#api-02
      return rateLimitedResponse(keyRate);
    }
    authedUserId = keyData.userId;
    isApiKeyAuth = true;

    // The dailyScans plan cap applies to API-key callers too (the key's own
    // dailyLimit is a broader apiRequestsPerDay throttle, unlimited on Elite).
    // Without this an API-key caller could run unlimited authenticated scans --
    // each spinning up a metered browser session -- past the finite dailyScans
    // cap. Read-only gate here; charged after the session is established below,
    // matching POST /api/v3/scan.
    const dailyQuota = await canMakeRequest(authedUserId);
    if (!dailyQuota.allowed) return dailyLimitResponse(dailyQuota);
    chargeDailyQuota = true;
    dailyQuotaLimit = dailyQuota.limit;
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
        Math.max(1, Math.ceil(rl.retryAfterSeconds)),
      );
    }

    const dailyQuota = await canMakeRequest(session.userId);
    if (!dailyQuota.allowed) return dailyLimitResponse(dailyQuota);
    chargeDailyQuota = true;
    dailyQuotaLimit = dailyQuota.limit;
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
  const { url } = parsed.data;
  const scannerSelection = parseScannerSelection(parsed.data.scanners);
  if (!scannerSelection.ok) {
    return ApiResponse.badRequest(scannerSelection.error);
  }
  const scanners = scannerSelection.scanners ?? undefined;
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
  // Both auth branches above either return early or assign authedUserId;
  // this guard only exists so TypeScript treats it as a plain number from
  // here on, the same shape POST /api/v3/scan uses.
  if (authedUserId === null) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }
  const teamAssignment = await resolveNewScanTeamIds(authedUserId, {
    teamId: parsed.data.teamId,
    teamIds: parsed.data.teamIds,
  });
  if (!teamAssignment.ok) {
    return ApiResponse.badRequest(teamAssignment.error);
  }
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

  // Domain ownership. Two separate reasons to demand it, both checked
  // before establishScanSession runs so an unverified target never gets a
  // login attempt:
  //
  // 1. Active probing, the same gate POST /api/v3/scan applies (see that
  //    route's own comment).
  // 2. Form login. `method: "form"` takes a caller-supplied username and
  //    password and POSTs them to the target's own login form, scraping the
  //    CSRF token first, then reports back distinguishably whether the
  //    credentials were rejected, accepted, or left the login form up. That
  //    is a credential-stuffing proxy with a built-in success oracle, run
  //    from this server's IP against a site the caller need never have
  //    proven any relationship to. Header and cookie auth are excluded: the
  //    caller is supplying a session or token they already hold, not
  //    submitting credentials to a login form for validation.
  const submitsCredentials = auth.method === "form";
  const wantsActiveProbing = requestsActiveProbing(scanners);
  // Asked at most once per request: both the gate below and the per-target
  // exemption after it want the same answer.
  let ownsTarget: boolean | undefined;
  const ownsUrl = async () =>
    (ownsTarget ??= await isUrlOwnedByUser(url, authedUserId));
  if ((wantsActiveProbing || submitsCredentials) && !(await ownsUrl())) {
    return NextResponse.json(
      {
        error: wantsActiveProbing
          ? "Active probing requires a verified domain. Verify ownership of this domain (or its parent) on the Attack surface page (/attack-surface) before requesting active-probes."
          : "A form login submits the username and password you supply to the target's own login page, so it requires a verified domain. Verify ownership of this domain (or its parent) on the Attack surface page (/attack-surface), or use header or cookie authentication with a session you already hold.",
        statusCode: "DOMAIN_NOT_VERIFIED",
      },
      { status: 403 },
    );
  }

  // Per-target volume, shared across every account, the same bucket POST
  // /scan, /scan/crawl and bulk count against. This route never consulted
  // it, so an authenticated scan (a login and a full scan of the page behind
  // it) was the one way to keep hitting a third-party site past the limit
  // the others enforce. Checked before the slot and the login, so a refused
  // target costs neither. A verified owner of the domain is exempt.
  // ref: AUDIT-012#abuse-05
  const targetLimit = await checkTargetScanLimit(url);
  if (!targetLimit.allowed && !(await ownsUrl())) {
    return burstLimitedResponse(
      targetLimit,
      targetScanLimitMessage(targetLimit.rootDomain),
      { statusCode: "TARGET_RATE_LIMIT", code: "TARGET_RATE_LIMIT" },
    );
  }

  // abuse: take one concurrency slot for the rest of this request. An
  // authenticated scan runs INLINE and only inserts its scan_history row
  // once it has finished, already 'completed', so the row-count limiter
  // every other scan path uses could never see one running: the per-plan
  // concurrentScans cap simply did not apply here. Taken after the target
  // and ownership gates so a rejected request never holds a slot.
  const slotted = await withInlineScanSlot(authedUserId, async () => {
    const loginResult = await establishScanSession(auth, url, authedUserId);
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

    // The authenticated session is established and the target validated, so the
    // scan is genuinely going ahead now -- charge the daily quota here rather
    // than up front, capped + atomic so a concurrent scan can't exceed the cap.
    if (chargeDailyQuota && authedUserId) {
      await incrementDailyCountCapped(authedUserId, dailyQuotaLimit);
    }

    const startTime = Date.now();
    let responseBody = "";
    let headers: Headers;
    let finalScanUrl = url;
    let pageBlocked: { status: number; server: string | null } | null = null;
    try {
      const response = await safeFetch(
        url,
        {
          method: "GET",
          headers: { "User-Agent": SCANNER_UA_AUTHENTICATED },
          redirect: "follow",
          signal: AbortSignal.timeout(fetchTimeoutMs),
        },
        [new URL(url).hostname],
        session,
      );
      // The same deadline as the request: the shared reader's own default is
      // shorter than SCAN_FETCH_TIMEOUT_MS, and a slow page that the fetch
      // signal would still have allowed was being cut short.
      responseBody = await readCappedBody(
        response,
        MAX_BODY_SIZE,
        fetchTimeoutMs,
      );
      headers = response.headers;
      // The login got through, and the page behind it can still be a bot
      // challenge, a WAF's refusal or a 5xx (lib/scanner/response-classifier
      // .ts). Graded as the signed-in page, it would be reported as the
      // site's own headers and markup.
      if (detectUnusablePage(response.status, headers, responseBody)) {
        pageBlocked = {
          status: response.status,
          server: headers.get("server"),
        };
      }
      // safeFetch restricts any redirect it follows to the same host (see its
      // own comment), so this is never a different site -- only a different
      // path/query on the one that was requested. Recorded separately from
      // `url`, which stays the identity finding ids are keyed on. The sync
      // checks judge finalScanUrl, since the headers and body came from it.
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

    // Capped at the SAME resolved setting the body was READ with, rather
    // than at a second hardcoded literal. This used to re-cap at 1,000,000
    // bytes: both settings ship a 1 MiB default and both describe themselves
    // as "bytes read from the response body BEFORE body-based checks run",
    // so the literal was a redundant second ceiling sitting 48 KB under the
    // shipped default and ignoring the setting outright. Raising the setting
    // to 5 MB read 5 MB off the wire and threw 4 MB away before any check
    // saw it.
    const bodyForChecks =
      responseBody.length > MAX_BODY_SIZE
        ? responseBody.slice(0, MAX_BODY_SIZE)
        : responseBody;

    // Same engine the unauthenticated scan routes use, so an authenticated
    // scan gets the same PageCheck coverage (JWT inspection, CSP/XFO
    // contradictions, form security, etc.) instead of only the legacy
    // header/body checks. This matters more here, not less: the whole point
    // of authenticating is to see the page a logged-out scan can't reach.
    // Yielding, like both other executors. This called the blocking
    // runSyncChecks, which the engine's own measurements put at ~1.2s of
    // uninterrupted synchronous work on a body at the cap - and this app runs
    // as one persistent Node process, so that is 1.2s during which every other
    // user's in-flight scan and every dashboard status poll is stalled.
    //
    // The engine's docblock called keeping it here deliberate, on the grounds
    // that the extra await "would change their control flow for no benefit
    // (they already run one page at a time)". Running one page at a time is a
    // fact about this caller; the cost was never paid by this caller. It is
    // paid by everyone else sharing the process, which the paragraph directly
    // above that one spells out. This handler is already async - there is an
    // await eleven lines up - so the await is free.
    const syncResult = pageBlocked
      ? noPageChecks()
      : await runSyncChecksYielding(
          url,
          headers,
          bodyForChecks,
          (scanners as Category[] | undefined) ?? null,
          undefined,
          finalScanUrl,
        );
    const syncFindings: Vulnerability[] = syncResult.findings;

    // The detailed variant behind the phase, not runAsyncChecks: an
    // authenticated scan is rendered through the same components as every
    // other scan, so it needs the same completeness bookkeeping. When the
    // phase's ceiling wins, every planned branch is listed as not completed,
    // so a run whose DNS, TLS and live-fetch branches all ran out of time is
    // never drawn as "Zero findings on this host. Every enabled check ran and
    // none of them fired." That is the one thing a scanner must never say
    // about a run it could not finish.
    const asyncScope = pageBlocked ? "network" : "all";
    const { findings: asyncFindings, incomplete: asyncIncomplete } =
      await startAsyncPhase({
        url,
        scanners: scanners ?? null,
        scope: asyncScope,
        checksTimeoutMs: asyncChecksTimeoutMs,
      });

    const findings = dedupeScanFindings([
      ...syncFindings,
      ...asyncFindings,
    ]).sort(
      (a, b) => SEVERITY_PRIORITY[b.severity] - SEVERITY_PRIORITY[a.severity],
    );

    const summary = summarizeFindings(findings);

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

    // Everything about this run that did NOT reach a conclusion, in the one
    // shape the result components already read (ScanResult.incomplete, whose
    // contract in lib/scanner/types.ts is "listed area means not checked, not
    // checked and clean"). A lost session belongs in it as much as a timed-out
    // branch does: the scan carried on against the signed-out surface, so the
    // authenticated area the caller actually asked about was never looked at,
    // and a zero-finding run must not read as clean because of it.
    const incomplete = [
      ...asyncIncomplete,
      ...(session.lost ? ["authenticated-session"] : []),
      ...(syncResult.checksErrored > 0 ? [PAGE_CHECKS_INCOMPLETE] : []),
      ...(pageBlocked ? [BOT_CHALLENGE_INCOMPLETE] : []),
    ];

    // Headline signals, same as a normal scan (getDangerScore/getEngineConfidence
    // are pure over the findings). Without these an authenticated scan showed
    // only duration + scanned time on the summary; they are also stored in
    // result_meta so the History view of this scan matches every other result.
    const dangerScore = getDangerScore(findings);
    const engineConfidence = getEngineConfidence(
      findings,
      incomplete.length > 0,
    );
    const resultMeta = {
      checksRun: syncResult.checksRun,
      ...(syncResult.checksErrored > 0
        ? {
            checksErrored: syncResult.checksErrored,
            erroredChecks: syncResult.erroredChecks,
          }
        : {}),
      dangerScore,
      engineConfidence,
      ...(incomplete.length > 0 ? { incomplete } : {}),
      // What answered in place of the signed-in page, as the single-page
      // executor records it.
      ...(pageBlocked ? { pageBlocked } : {}),
    };

    let scanHistoryId: number | null = null;
    let scanPublicId: string | null = null;
    /** Set when the one INSERT this route performs did not land. */
    let persistError: string | null = null;
    try {
      // Never a credential_id column, never any credential material: only
      // the boolean fact that this scan ran authenticated.
      const insertResult = await pool.query(
        `INSERT INTO scan_history
           (user_id, url, summary, findings, findings_count, duration, scanned_at,
            source, response_headers, notes, authenticated, is_public, result_meta, team_id)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, true, $10, $11, $12)
         RETURNING id, public_id`,
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
          JSON.stringify(resultMeta),
          teamAssignment.primaryTeamId,
        ],
      );
      scanHistoryId = insertResult.rows[0]?.id ?? null;
      scanPublicId = insertResult.rows[0]?.public_id ?? null;
      // The INSERT above carries the primary team; this writes the rest of
      // the set into scan_history_teams and is a no-op below two teams.
      if (scanHistoryId !== null) {
        await attachNewScanTeams(scanHistoryId, teamAssignment.teamIds);
      }
    } catch (err) {
      console.error(
        "[scan/authenticated] Failed to save scan history:",
        err instanceof Error ? err.message : err,
      );
      // Remembered, because the response has to admit it.
      //
      // This INSERT is the only persistence this route performs, and
      // swallowing it left scanHistoryId null while the route still returned
      // 200 with the full body. Two guards further down then read that null
      // and silently skipped the auto-tags AND the entire notifyScanComplete
      // tail: no scan-complete email, no critical-findings alert, no webhook
      // delivery. A CI consumer keyed on that webhook saw silence, which
      // reads as "nothing to report" rather than "the scan was never saved".
      persistError = err instanceof Error ? err.message : "could not be saved";
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

    // The shared notification tail every other scan path runs
    // (lib/webhooks/scan-notifications.ts): the scan-complete email, the
    // critical/high regression alert, and every webhook the caller or the
    // scan's team registered. This route builds its own pipeline instead of
    // calling executeScan, so it used to fire none of the three -- the
    // deepest scan on offer, and the one most likely to surface something
    // real behind a login, completed in total silence.
    //
    // `incomplete` is passed through rather than dropped for the same reason
    // it reaches the screen: a run whose DNS and TLS branches timed out, or
    // whose session was lost partway, must not be notified as a clean scan.
    // Fire-and-forget, like upsertHostReputation above: the notification
    // cannot delay or fail this response, and the helper never rejects.
    if (scanHistoryId !== null) {
      void notifyScanComplete({
        userId: authedUserId,
        scanId: scanHistoryId,
        // finalScanUrl, matching the scan_history.url this route persisted a
        // few lines up, so the regression diff finds the previous scans of
        // this same target instead of treating every run as the first.
        target: { kind: "url", value: finalScanUrl },
        summary,
        findings,
        duration,
        scannedAt: new Date().toISOString(),
        incomplete,
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
      // The opaque id the scan's URLs and the v4 API use. scanHistoryId stays
      // for v3 clients.
      scanPublicId,
      // Explicit rather than inferred from a null id: a caller reading this
      // response can tell "saved" from "ran, but nothing was written and no
      // notification will follow", which used to be indistinguishable.
      persisted: scanHistoryId !== null,
      ...(persistError ? { persistError } : {}),
      url,
      scannedAt: new Date().toISOString(),
      duration,
      findings,
      summary,
      responseHeaders: redactedHeaders,
      authReport,
      dangerScore,
      engineConfidence,
      checksRun: syncResult.checksRun,
      // Only present when something genuinely did not finish. Its absence is
      // the claim "everything ran"; sending an empty array every time would
      // make the two indistinguishable to any consumer that only checks for
      // the key.
      ...(incomplete.length > 0 ? { incomplete } : {}),
    });
  });
  if (!slotted.ok) {
    // Same body shape POST /api/v3/scan returns for the same condition, now
    // with Retry-After.
    return concurrentScanLimitResponse(slotted.check.message);
  }
  return slotted.value;
}

export const POST = versioned(
  "scan.createAuthenticated",
  withErrorHandling(createAuthenticatedScan),
);
