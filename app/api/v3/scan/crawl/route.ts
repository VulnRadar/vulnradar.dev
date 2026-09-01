import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { executeCrawlScan } from "@/lib/scanner/execute-crawl-scan";
import { finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import {
  canMakeRequest,
  getRateLimitHeaders,
} from "@/lib/rate-limiting/daily-limits";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import {
  checkTargetScanLimit,
  targetScanLimitMessage,
} from "@/lib/rate-limiting/target-limits";
import { resolveScanIsPublic } from "@/lib/scanner/scan-privacy";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { requestsActiveProbing } from "@/lib/scanner/active-probe-catalog";
import {
  checkConcurrentScanLimit,
  reserveConcurrentScanSlot,
} from "@/lib/rate-limiting/concurrent-scans";
import { logAction } from "@/lib/auth/authorization";
import {
  resolveNewScanTeamIds,
  attachNewScanTeams,
} from "@/lib/teams/scan-teams";
import { normalizeUrl } from "@/lib/scanner/execute-scan";
import { establishScanSession } from "@/lib/scanner/auth/login";
import {
  buildAuthRequestSchema,
  toEphemeralAuth,
} from "@/lib/scanner/auth/request-schema";
import type {
  EphemeralAuthInput,
  ScanAuthReport,
  ScanSessionBinding,
} from "@/lib/scanner/auth/types";

export async function POST(request: NextRequest) {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let apiKeyId: number | null = null;
  let isApiKeyAuth = false;
  let authedUserId: number | null = null;
  // The single api_usage slot this crawl consumes (checkApiKeyRateLimit counts
  // AND inserts atomically). Captured from the gate and reused for the success
  // headers -- calling checkApiKeyRateLimit again there would insert a second
  // usage row and charge the crawl twice.
  let apiKeyRateLimit: Awaited<ReturnType<typeof checkApiKeyRateLimit>> | null =
    null;

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

    // Check API key rate limit (the ONE atomic count+insert for this crawl;
    // reused for the success headers below, never re-called).
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    apiKeyRateLimit = rateLimit;

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded. ${rateLimit.limit} requests per 24 hours. Resets at ${rateLimit.resetsAt}`,
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

  // Daily scan quota, based on subscription plan (dailyScans). This is a
  // read-only gate: the crawl executor increments the daily counter once per
  // page it actually scans (execute-crawl-scan.ts's incrementDailyCount loop),
  // so it must NOT also record here. An earlier version called
  // checkAndRecordRequest, which burned one extra slot per crawl (charged the
  // first page twice) and capped pages one lower than the plan allowed.
  const dailyQuota = await canMakeRequest(authedUserId);
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

  // Capacity, not demand-shaping -- see POST /api/v3/scan's identical
  // check and lib/rate-limiting/concurrent-scans.ts. A crawl's own tracker
  // row counts as one slot, same as a single-URL scan.
  const concurrency = await checkConcurrentScanLimit(authedUserId);
  if (!concurrency.allowed) {
    return NextResponse.json(
      { error: concurrency.message, statusCode: "CONCURRENT_SCAN_LIMIT" },
      { status: 429 },
    );
  }

  const body = await request.json();
  const url: string = body.url;
  const selectedUrls: string[] | undefined = body.urls;
  const scanners: string[] | null =
    Array.isArray(body.scanners) && body.scanners.length > 0
      ? body.scanners
      : null;
  // Opt-in main-URL screenshot (see ExecuteCrawlScanParams.captureScreenshot).
  // Never implied -- a screenshot spins up a real, metered BrowserBase
  // session, so it only runs when explicitly requested.
  const captureScreenshot = body.captureScreenshot === true;
  // Opt-in curated port/service sweep of the crawl's main host (see
  // ExecuteCrawlScanParams.portScan). Off unless explicitly requested and held
  // to the same verified-domain gate active probing uses, enforced below.
  const portScan = body.portScan === true;
  // Optional authenticated crawl. When an `auth` block is present the crawl
  // establishes a session once and threads it through every page fetch, using
  // the same admin toggle, schema, and limits as the single-page
  // authenticated route. When absent, this route behaves exactly as before:
  // no session, no authenticated flag, unchanged privacy.
  const authRequested = body.auth != null && typeof body.auth === "object";

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

  // Per-plan cap on how many pages ONE crawl may cover. Discovery
  // (CRAWL_DISCOVER_MAX_PAGES) can surface far more pages than this so the
  // picker lists options; the cap here is how many the caller may actually
  // queue for scanning. The client picker enforces the same number from the
  // shipped table (lib/billing/crawl-page-limits.ts), so a longer selectedUrls
  // array here is a bypass attempt and is rejected. Also threaded into
  // executeCrawlScan so the engine's own discovery path respects the same cap.
  //
  // Resolved through getUserPlanLimits rather than the synchronous shipped
  // table: these four numbers now have BILLING_*_CRAWL_PAGES registry entries,
  // so an admin retuning them has to actually take effect here. It returns
  // null when billing is off, which is the same "self-hosted is unlimited"
  // answer the separate BILLING_ENABLED read used to produce, so that read is
  // gone rather than duplicated. getUserPlanLimits, not getPlanLimitsForPlan:
  // it checks billing FIRST, so a self-hosted deployment still never pays for
  // the plan lookup at all.
  const crawlPlanLimits = await getUserPlanLimits(authedUserId);
  const crawlPageLimit = crawlPlanLimits?.crawlPages ?? -1;
  if (
    Array.isArray(selectedUrls) &&
    crawlPageLimit !== -1 &&
    selectedUrls.length > crawlPageLimit
  ) {
    return NextResponse.json(
      {
        error: `Your plan lets you scan up to ${crawlPageLimit} pages per crawl. Deselect some pages or upgrade your plan for more.`,
        statusCode: "CRAWL_PAGE_LIMIT",
      },
      { status: 403 },
    );
  }

  // Accept a bare domain (example.com) exactly like POST /api/v3/scan and the
  // authenticated route: prepend https:// via normalizeUrl before parsing, so
  // the crawl entry never 400s on input the single-page scan accepts. Without
  // this a bare "example.com" from the crawl page-picker hit new URL() raw and
  // failed with "Invalid URL", the rejection the picker's "Scan N pages" step
  // was showing.
  let mainUrl: URL;
  try {
    mainUrl = new URL(normalizeUrl(url));
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

  // Validate the optional auth block up front: gate on the same admin setting
  // the single-page route uses (identical 403), normalize a bare-domain
  // loginUrl, and parse it against the shared schema/limits. The session
  // itself is established later, only after the safety and ownership checks
  // below pass. Credential material never leaves this handler.
  let ephemeralAuth: EphemeralAuthInput | null = null;
  if (authRequested) {
    const scanAuthEnabled = await getSetting("SCAN_AUTH_ENABLED");
    if (!scanAuthEnabled) {
      return NextResponse.json(
        { error: "Authenticated scanning is disabled on this deployment." },
        { status: 403 },
      );
    }
    // Same gap-fix as the single-page route: normalize a bare-domain loginUrl
    // (prepend https://) before it reaches the schema's z.string().url() check.
    const authBody = body.auth as Record<string, unknown>;
    if (typeof authBody.loginUrl === "string" && authBody.loginUrl !== "") {
      authBody.loginUrl = normalizeUrl(authBody.loginUrl);
    }
    const { SCAN_AUTH_MAX_SECRET_LENGTH, SCAN_AUTH_MAX_COOKIES } =
      await getSettings([
        "SCAN_AUTH_MAX_SECRET_LENGTH",
        "SCAN_AUTH_MAX_COOKIES",
      ] as const);
    const authSchema = buildAuthRequestSchema({
      maxSecretLength: SCAN_AUTH_MAX_SECRET_LENGTH,
      maxCookies: SCAN_AUTH_MAX_COOKIES,
    });
    const parsedAuth = authSchema.safeParse(body.auth);
    if (!parsedAuth.success) {
      return NextResponse.json(
        {
          error: parsedAuth.error.issues[0]?.message || "Invalid auth block.",
        },
        { status: 400 },
      );
    }
    // Credential material lives only in this local for the rest of the
    // request. It is never assigned anywhere that outlives this handler, and
    // never reaches the DB, a log line, or a response.
    ephemeralAuth = toEphemeralAuth(parsedAuth.data);
  }

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

  // Per-target volume, shared across every account (see
  // lib/rate-limiting/target-limits.ts). A crawl is the heaviest thing this
  // product points at a third party -- one scan's worth of requests times the
  // page count -- so it counts against the target's bucket like every other
  // scan, and a verified owner of the domain is exempt. Counted as one, not as
  // one per page: the page count is not known until discovery has run, and
  // charging the bucket per page would make a single legitimate 250-page crawl
  // of an unverified domain lock that domain out for the hour.
  // ref: AUDIT-012#abuse-05
  const crawlTargetLimit = await checkTargetScanLimit(normalizedMainUrl);
  if (
    !crawlTargetLimit.allowed &&
    !(await isUrlOwnedByUser(normalizedMainUrl, authedUserId))
  ) {
    return NextResponse.json(
      {
        error: targetScanLimitMessage(crawlTargetLimit.rootDomain),
        statusCode: "TARGET_RATE_LIMIT",
      },
      {
        status: 429,
        headers: { "Retry-After": String(crawlTargetLimit.retryAfterSeconds) },
      },
    );
  }

  // Domain ownership: same gate as POST /api/v3/scan -- see that route's
  // own comment for why active-probes needs this and the others don't. A
  // curated port sweep (portScan) is held to the same gate: it makes this
  // server a scan source against the target. A form login is too: it POSTs
  // the caller's username and password to the target's own login page and
  // reports back distinguishably whether they were accepted, which is a
  // credential-stuffing proxy with a success oracle unless the caller has
  // proven they control the domain. Header and cookie auth stay ungated --
  // the caller is supplying a session they already hold. One check covers
  // all three; the `||` chain short-circuits so an ordinary crawl never pays
  // for the DB lookup.
  const wantsActiveProbing = requestsActiveProbing(scanners);
  const submitsCredentials = ephemeralAuth?.method === "form";
  if (
    (wantsActiveProbing || portScan || submitsCredentials) &&
    !(await isUrlOwnedByUser(normalizedMainUrl, authedUserId))
  ) {
    return NextResponse.json(
      {
        error: wantsActiveProbing
          ? "Active probing requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before requesting active-probes."
          : portScan
            ? "Port scanning requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains before requesting a port scan."
            : "A form login submits the username and password you supply to the target's own login page, so it requires a verified domain. Verify ownership of this domain (or its parent) in Profile > Domains, or use header or cookie authentication with a session you already hold.",
        statusCode: "DOMAIN_NOT_VERIFIED",
      },
      { status: 403 },
    );
  }

  // Establish the authenticated session once, after the safety and ownership
  // checks above, and abort before creating any scan row if the login cannot
  // be trusted -- exactly like the single-page authenticated route. On failure
  // nothing is persisted and no credential material is echoed: the 422 body
  // carries only the non-secret authReport (status/method/reason).
  let session: ScanSessionBinding | null = null;
  if (ephemeralAuth) {
    const loginResult = await establishScanSession(
      ephemeralAuth,
      normalizedMainUrl,
    );
    if (!loginResult.ok) {
      const authReport: ScanAuthReport = {
        status: "failed",
        method: ephemeralAuth.method,
        reason: loginResult.reason,
      };
      return NextResponse.json(
        {
          error: `Authenticated crawl aborted: ${loginResult.reason}`,
          status: 422,
          authReport,
        },
        { status: 422 },
      );
    }
    session = loginResult.session;
  }

  // Public by default (matches scan_history.is_public's DB default), unless
  // the request explicitly says otherwise, or (when it says nothing) the
  // account's own "scans are private by default" setting says otherwise.
  // Resolved this late so a request rejected above never pays for the
  // account-default lookup. See lib/scanner/scan-jobs.ts's
  // finalizeScanSuccess, the shared completion path for this and
  // scan/route.ts.
  //
  // An authenticated crawl is the exception: it sees whatever a logged-in
  // area renders, a strictly more sensitive default than any logged-out crawl,
  // so it is private unless THIS request explicitly sets isPublic:true --
  // never the is_public default and never the account "private by default"
  // setting, from either direction. Mirrors the single-page route's
  // requestedIsPublic.
  const requestedIsPublic = ephemeralAuth
    ? body.isPublic === true
    : await resolveScanIsPublic(
        authedUserId,
        typeof body.isPublic === "boolean" ? body.isPublic : undefined,
      );

  // Team assignment for the tracker row. Omitted means a personal crawl;
  // only a request that names teams the caller can manage shares it.
  // `teamIds` shares with several at once, `teamId` is the original
  // single-team form. The per-page rows executeCrawlScan inserts are not
  // covered here: it copies the tracker's scan_history.team_id onto each
  // page, so a multi-team crawl currently shares its discovered pages with
  // the PRIMARY team only -- see lib/scanner/execute-crawl-scan.ts.
  const teamAssignment = await resolveNewScanTeamIds(authedUserId, body);
  if (!teamAssignment.ok) {
    return NextResponse.json({ error: teamAssignment.error }, { status: 400 });
  }

  // Create the tracker row immediately so there is something to poll. Page
  // discovery and the daily-quota check both depend on work that happens
  // in the background (discovery is itself a multi-fetch crawl), so unlike
  // scan/route.ts, the "categories total" for this row starts at 0 and is
  // filled in once the page count is known — see executeCrawlScan.
  let scanHistoryId: number;
  try {
    // Reserve the concurrency slot and insert the tracker row in one locked
    // transaction so parallel crawls can't race past the earlier
    // check-then-act concurrency check and overshoot the cap.
    const reservation = await reserveConcurrentScanSlot(
      authedUserId,
      async (client) => {
        const insertResult = await client.query(
          `INSERT INTO scan_history
             (user_id, url, source, notes, status, started_at, categories_total, is_public, team_id)
           VALUES ($1, $2, $3, $4, 'pending', NOW(), 0, $5, $6)
           RETURNING id`,
          [
            authedUserId,
            normalizedMainUrl,
            isApiKeyAuth ? "api" : "web",
            DEFAULT_SCAN_NOTE,
            requestedIsPublic,
            teamAssignment.primaryTeamId,
          ],
        );
        const insertedId = insertResult.rows[0]?.id;
        if (!insertedId) throw new Error("Insert returned no id");
        return insertedId as number;
      },
    );
    if (!reservation.ok) {
      return NextResponse.json(
        { error: reservation.check.message },
        { status: 429 },
      );
    }
    scanHistoryId = reservation.scanId;
    // The INSERT above carries the primary team; this writes the rest of the
    // set into scan_history_teams and is a no-op below two teams.
    await attachNewScanTeams(scanHistoryId, teamAssignment.teamIds);
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
    captureScreenshot,
    portScan,
    crawlPageLimit,
    // Each discovered page's row inherits the crawl's privacy. Without this,
    // scan_history.is_public defaults to true and a private/authenticated
    // crawl would publish every page it touched.
    isPublic: requestedIsPublic,
    // In-memory session only when the crawl authenticated -- never persisted.
    ...(session ? { session, authenticated: true } : {}),
  }).catch(async (err) => {
    // A throw BEFORE executeCrawlScan arms its watchdog (e.g. getSettings
    // failing) would otherwise leave this row stuck 'pending' forever plus an
    // unhandled rejection; mark it failed if the background job escapes.
    const message =
      err instanceof Error ? err.message : "Crawl scan failed to start.";
    console.error(`[${APP_NAME}] executeCrawlScan dispatch failed:`, message);
    await finalizeScanFailure(scanHistoryId, message).catch(() => {});
  });

  // Audit the non-secret fact that an authenticated crawl ran: origin, method,
  // and the login outcome only -- never a username, password, header value, or
  // cookie value reaches this string.
  if (ephemeralAuth && session) {
    await logAction(
      authedUserId,
      authedUserId,
      "scan.authenticated",
      `Ran an authenticated crawl of ${mainUrl.origin} (${ephemeralAuth.method} auth, result: ${
        session.lost ? "lost" : "authenticated"
      }).`,
    );
  }

  // Add rate limit headers from the SAME api_usage slot the gate consumed at
  // the top of this request. The slot was already counted+inserted there, so we
  // must not call checkApiKeyRateLimit again (that would insert a second usage
  // row and charge the crawl twice). apiKeyRateLimit is always set on this path.
  if (isApiKeyAuth && apiKeyId && apiKeyRateLimit) {
    return NextResponse.json(
      { scanId: scanHistoryId, status: "running" },
      {
        headers: {
          "X-RateLimit-Limit": String(apiKeyRateLimit.limit),
          "X-RateLimit-Remaining": String(apiKeyRateLimit.remaining),
          "X-RateLimit-Reset": apiKeyRateLimit.resetsAt,
        },
      },
    );
  }

  return NextResponse.json({ scanId: scanHistoryId, status: "running" });
}
