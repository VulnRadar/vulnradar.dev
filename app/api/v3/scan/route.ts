import { NextRequest, NextResponse } from "next/server";
import { getPlannedSyncCategories } from "@/lib/scanner/engine";
import { getPlannedAsyncBranches } from "@/lib/scanner/async-checks";
import {
  executeScan,
  normalizeUrl,
  isRawIpv4,
  isValidUrl,
  getProtocolType,
} from "@/lib/scanner/execute-scan";
import { getSession } from "@/lib/auth";
import { validateApiKey, checkRateLimit } from "@/lib/api/api-keys";
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
  canMakeRequest,
  incrementDailyCountCapped,
  getRateLimitHeaders,
} from "@/lib/rate-limiting/daily-limits";
import type { Category } from "@/lib/scanner/types";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { requestsActiveProbing } from "@/lib/scanner/active-probe-catalog";
import { reserveConcurrentScanSlot } from "@/lib/rate-limiting/concurrent-scans";
import {
  checkTargetScanLimit,
  targetScanLimitMessage,
} from "@/lib/rate-limiting/target-limits";
import { checkAccessRules } from "@/lib/scanner/access-rules";
import { resolveScanIsPublic } from "@/lib/scanner/scan-privacy";
import {
  resolveNewScanTeamIds,
  attachNewScanTeams,
} from "@/lib/teams/scan-teams";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { rateLimitedEmail } from "@/lib/email/email";

export async function POST(request: NextRequest) {
  try {
    // Auth: check API key first (Bearer token), then fall back to session cookie
    const authHeader = request.headers.get("authorization");
    let apiKeyId: number | null = null;
    let isApiKeyAuth = false;
    let authedUserId: number | null = null;
    // The single quota row this request consumes (checkRateLimit both counts
    // AND inserts atomically). Captured from the gate below and reused for the
    // success-response headers -- calling checkRateLimit a second time there
    // would insert a SECOND usage row and charge every scan twice.
    let apiKeyRateLimit: Awaited<ReturnType<typeof checkRateLimit>> | null =
      null;
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

      // Check rate limit (this is the ONE atomic count+insert for this
      // request; reused for the success headers below, never re-called).
      const rateLimit = await checkRateLimit(keyData.keyId, keyData.dailyLimit);
      apiKeyRateLimit = rateLimit;

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
    // Read-only gate here; the counter is CHARGED only after validation and a
    // successful slot reservation below (see incrementDailyCountCapped after
    // the reserve). Charging up front used to burn a scan from the daily
    // allowance for requests that were then rejected (concurrency 429, an
    // invalid/SSRF-blocked URL, an unverified domain) with no refund path.
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

    // Concurrent-scan capacity (VulnRadar runs as one persistent process with
    // no job queue, so every 'pending'/'running' scan shares its resources)
    // is enforced ONLY by reserveConcurrentScanSlot below, which counts and
    // inserts inside one advisory-locked transaction. The best-effort
    // check-then-act pre-check that used to sit here resolved the user's plan
    // and ran the same COUNT a second time on every single scan, two extra
    // round trips in front of the request purely to fail slightly earlier for
    // the rare caller who is already at capacity.

    const body = await request.json();
    const { url, scanners, isPublic } = body;
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

    // Domain ownership: active-probes submits real exploit-attempt
    // payloads (SQLi/XSS/SSTI canaries, a live GraphQL introspection
    // query) to the target instead of only reading responses -- it must
    // never run against a URL the caller hasn't proven control over (see
    // lib/domains/scope.ts). This is a authorization gate, separate from
    // (and in addition to) the SSRF/access-rules safety checks below,
    // which apply regardless of which categories are requested.
    // A curated port sweep (portScan) is held to the exact same gate: it makes
    // this server a scan source against the target, so the caller must own the
    // domain. One ownership check covers both intrusive capabilities; the
    // ternary short-circuits so an ordinary scan (no active probes, no port
    // scan) never pays for the DB lookup at all.
    const wantsActiveProbing = requestsActiveProbing(selectedScanners);
    const needsOwnershipCheck = wantsActiveProbing || portScan;

    // These five gates do not depend on each other, so they run as ONE wave
    // instead of five sequential round trips (a blocking DNS resolution plus
    // up to four DB queries) in front of every scan. They are still EVALUATED
    // in the original priority order below, so a request failing more than
    // one of them gets exactly the error it got before. The trade-off: a
    // request that fails an early gate now also pays for the later lookups it
    // used to skip, which is a fixed cost paid once against a saving paid on
    // every successful scan.
    const [
      safetyCheck,
      accessCheck,
      ownsUrl,
      requestedIsPublic,
      teamAssignment,
      targetLimit,
    ] = await Promise.all([
      // SSRF protection - validate target is not internal/private
      validateScanTarget(normalizedUrl),
      // Access rules (blacklist/whitelist)
      checkAccessRules(normalizedUrl),
      needsOwnershipCheck
        ? isUrlOwnedByUser(normalizedUrl, authedUserId)
        : Promise.resolve(true),
      // Public unless the request explicitly says otherwise, or (when it
      // says nothing) the account's own "scans are private by default"
      // setting says otherwise. See lib/scanner/scan-jobs.ts's
      // finalizeScanSuccess, which skips upsertHostReputation for a scan
      // whose is_public ends up false here.
      resolveScanIsPublic(
        authedUserId,
        typeof isPublic === "boolean" ? isPublic : undefined,
      ),
      // Team assignment. Omitted means a personal scan, which is what every
      // scan was before this: no creation path wrote the column, so GET
      // /api/v3/teams/member-scans could only ever return an empty list
      // however many teams the account belonged to. Only a request that names
      // teams the caller can manage shares the scan with them. `teamIds`
      // shares with several at once; `teamId` is the original single-team
      // form and still works.
      resolveNewScanTeamIds(authedUserId, body),
      // Volume aimed at the TARGET, shared across every account rather than
      // scoped to this caller (see lib/rate-limiting/target-limits.ts). It
      // counts here, inside the same wave as the other gates, so a request
      // that is refused further down still contributes: over-counting a
      // protection limiter fails safe, under-counting it does not.
      checkTargetScanLimit(normalizedUrl),
    ]);

    if (!safetyCheck.safe) {
      return NextResponse.json(
        { error: safetyCheck.reason || "URL blocked for security reasons" },
        { status: 400 },
      );
    }

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

    if (!targetLimit.allowed) {
      // A verified owner of the domain is exempt: this limit exists to stop
      // VulnRadar being pointed at a THIRD party in volume, and someone who
      // has proven control of the domain is not a third party. The ownership
      // lookup is paid for only on this rejection path (and reuses the one the
      // wave above already ran when active probing or a port scan was asked
      // for), so an ordinary scan never adds a query for it.
      const ownsTarget = needsOwnershipCheck
        ? ownsUrl
        : await isUrlOwnedByUser(normalizedUrl, authedUserId);
      if (!ownsTarget) {
        return NextResponse.json(
          {
            error: targetScanLimitMessage(targetLimit.rootDomain),
            statusCode: "TARGET_RATE_LIMIT",
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(targetLimit.retryAfterSeconds),
            },
          },
        );
      }
    }

    if (needsOwnershipCheck && !ownsUrl) {
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

    if (!teamAssignment.ok) {
      return NextResponse.json(
        { error: teamAssignment.error },
        { status: 400 },
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
      // Reserve the concurrency slot and insert the row in one locked
      // transaction so parallel requests can't race past the earlier
      // check-then-act concurrency check and overshoot the cap.
      const reservation = await reserveConcurrentScanSlot(
        authedUserId,
        async (client) => {
          const insertResult = await client.query(
            `INSERT INTO scan_history
               (user_id, url, source, notes, status, started_at, categories_total, is_public, team_id)
             VALUES ($1, $2, $3, $4, 'pending', NOW(), $5, $6, $7)
             RETURNING id`,
            [
              authedUserId,
              normalizedUrl,
              isApiKeyAuth ? "api" : "web",
              DEFAULT_SCAN_NOTE,
              categoriesTotal,
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
        // Same body the removed pre-check returned, so an API client keying
        // on statusCode sees no change now that the reservation is the only
        // concurrency gate.
        return NextResponse.json(
          {
            error: reservation.check.message,
            statusCode: "CONCURRENT_SCAN_LIMIT",
          },
          { status: 429 },
        );
      }
      scanHistoryId = reservation.scanId;
      // The INSERT above carries the primary team; this writes the rest of
      // the set into scan_history_teams and is a no-op below two teams.
      await attachNewScanTeams(scanHistoryId, teamAssignment.teamIds);
      // Charge the daily quota now that the scan is definitely going ahead
      // (validated + slot reserved). Capped + atomic so a concurrent scan
      // can't push the counter past the cap; if the cap was reached in the
      // meantime the scan still runs (rare) rather than being killed after
      // the row exists.
      await incrementDailyCountCapped(authedUserId, dailyQuota.limit);
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
    // Detached from the request lifecycle. A throw BEFORE executeScan arms
    // its watchdog (e.g. getSettings failing) would otherwise leave this row
    // stuck 'pending' forever plus an unhandled rejection, so mark it failed
    // if the background job escapes.
    void executeScan({
      scanId: scanHistoryId,
      url,
      normalizedUrl,
      protocolType,
      isRawIpTarget,
      selectedScanners,
      authedUserId,
      categoriesTotal,
      captureScreenshot,
      portScan,
    }).catch(async (err) => {
      const message =
        err instanceof Error ? err.message : "Scan failed to start.";
      console.error(`[${APP_NAME}] executeScan dispatch failed:`, message);
      await finalizeScanFailure(scanHistoryId, message).catch(() => {});
    });

    // Add rate limit headers from the SAME quota row the gate consumed at the
    // top of this request -- the slot was already counted+inserted there, so we
    // must not call checkRateLimit again (that would insert a second usage row
    // and charge the scan twice). apiKeyRateLimit is always set on this path
    // because the gate ran before we got here.
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
