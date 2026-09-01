import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  canMakeRequest,
  getDailyLimit,
  incrementDailyCountCapped,
  getRateLimitHeaders,
} from "@/lib/rate-limiting/daily-limits";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
  peekRateLimit as peekApiKeyRateLimit,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";
import { reserveConcurrentScanBatch } from "@/lib/rate-limiting/concurrent-scans";
import {
  checkTargetScanLimit,
  targetScanLimitMessage,
} from "@/lib/rate-limiting/target-limits";
import { isUrlOwnedByUser } from "@/lib/domains/scope";
import { getUserPlanLimits, planLimitMessage } from "@/lib/billing/plan-limits";
import { resolveScanIsPublic } from "@/lib/scanner/scan-privacy";
import {
  resolveNewScanTeamIds,
  attachNewScanTeams,
} from "@/lib/teams/scan-teams";
import { getPlannedSyncCategories } from "@/lib/scanner/engine";
import { getPlannedAsyncBranches } from "@/lib/scanner/async-checks";
import { isRawIpv4, getProtocolType } from "@/lib/scanner/execute-scan";
import {
  runBulkBatch,
  type BulkQueuedScan,
} from "@/lib/scanner/execute-bulk-scan";
import { finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import {
  APP_NAME,
  BEARER_PREFIX,
  DEFAULT_SCAN_NOTE,
} from "@/lib/config/constants";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { checkAccessRules } from "@/lib/scanner/access-rules";

const SUPPORTED_PROTOCOLS = ["http:", "https:", "ws:", "wss:", "ftp:", "ftps:"];

const DAILY_LIMIT_MESSAGE =
  "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.";

/** One entry in the batch response: either a queued scan or a refusal. */
type BulkResultEntry =
  | { url: string; success: true; scanId: number; status: "queued" }
  | { url: string; success: false; error: string; details?: string };

/**
 * SSRF and access-rule gates for one URL in the batch. Runs BEFORE the URL is
 * charged a daily scan and before its row is reserved: these two checks used
 * to run after the quota had already been consumed, so a batch of
 * internal/blacklisted hosts burned one scan from the account's allowance per
 * URL for work that never ran, with no refund path. POST /api/v3/scan
 * documents and enforces the same ordering.
 *
 * Returns null when the URL is fine, or the result row to push otherwise.
 */
async function validateBulkTarget(
  url: string,
  // perf: the operator blocklist is keyed on the host, and a bulk batch is
  // usually many paths on a handful of hosts, so the same two queries were
  // re-run per URL for an answer that cannot differ within one request. The
  // cache is created per request and thrown away with it, so a rule an admin
  // adds mid-batch applies from the next request, exactly as before for any
  // host this batch had not already looked up (AUDIT-012#perf-18).
  // validateScanTarget is deliberately NOT cached: it resolves DNS, and
  // re-resolving per URL is part of how the SSRF guard stays honest.
  accessRuleCache?: Map<string, Awaited<ReturnType<typeof checkAccessRules>>>,
): Promise<BulkResultEntry | null> {
  const safetyCheck = await validateScanTarget(url);
  if (!safetyCheck.safe) {
    return {
      url,
      success: false,
      error: safetyCheck.reason || "URL blocked for security reasons",
    };
  }

  let host: string | null = null;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = null;
  }

  const cached = host ? accessRuleCache?.get(host) : undefined;
  const accessCheck = cached ?? (await checkAccessRules(url));
  if (host && !cached) accessRuleCache?.set(host, accessCheck);

  if (!accessCheck.allowed) {
    return {
      url,
      success: false,
      error: "This target cannot be scanned.",
      details:
        "This domain or IP address has been restricted from scanning for security, privacy, or compliance reasons. Access controls are enforced to protect sensitive infrastructure and user data.",
    };
  }

  return null;
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
    // without consuming a slot. This is a READ-ONLY peek (peekApiKeyRateLimit)
    // -- the actual per-URL billing is the atomic checkApiKeyRateLimit in the
    // admission loop below, so each URL consumes one slot (a 100-URL bulk call
    // costs 100, not 1). Using the incrementing checkRateLimit here would have
    // burned a phantom slot the request never used, making a bulk of N cost
    // N+1.
    const earlyCheck = await peekApiKeyRateLimit(
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

  const { urls, isPublic, teamId, teamIds } = await request.json();

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json(
      { error: "Provide an array of URLs." },
      { status: 400 },
    );
  }
  const { MAX_URL_LENGTH, MAX_URLS_BULK } = await getSettings([
    "MAX_URL_LENGTH",
    "MAX_URLS_BULK",
  ] as const);

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
  // is the atomic incrementDailyCountCapped call in the admission loop below.
  const quotaCheck = await canMakeRequest(authedUserId!);
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      { error: DAILY_LIMIT_MESSAGE },
      { status: 429, headers: getRateLimitHeaders(quotaCheck) },
    );
  }

  // How many URLs can we actually run given remaining quota?
  const remaining =
    quotaCheck.limit === -1
      ? validUrls.length
      : Math.min(validUrls.length, quotaCheck.remaining);
  const urlsToScan = validUrls.slice(0, remaining);
  const skippedUrls = validUrls.slice(remaining);

  // One privacy flag for the whole batch (a bulk scan has no per-URL privacy
  // UI). Resolved HERE, after validation and quota gating, so an invalid or
  // rejected request never triggers the account-setting DB lookup. An explicit
  // boolean wins; when the field is absent we fall back to the account's
  // scans_private_by_default via resolveScanIsPublic -- the same resolver the
  // single-scan/crawl/scheduled paths use. Previously this defaulted to public
  // regardless of that setting, so an API bulk call from a "private by default"
  // account published every URL's findings to the public host pages.
  const requestedIsPublic = await resolveScanIsPublic(
    authedUserId!,
    typeof isPublic === "boolean" ? isPublic : undefined,
  );

  // One team assignment for the whole batch, same shape as the privacy flag
  // above. Omitted means personal scans, which is what every bulk scan was
  // before: the INSERT never wrote the column, so a team could never see a
  // batch a member ran for it. `teamIds` shares the batch with several teams
  // at once; `teamId` is the original single-team form.
  const teamAssignment = await resolveNewScanTeamIds(authedUserId!, {
    teamId,
    teamIds,
  });
  if (!teamAssignment.ok) {
    return NextResponse.json({ error: teamAssignment.error }, { status: 400 });
  }

  const results: BulkResultEntry[] = [];

  // Target gates run for every URL BEFORE anything is charged or reserved, so
  // a rejected target costs the caller nothing (see validateBulkTarget).
  const accessRuleCache = new Map<
    string,
    Awaited<ReturnType<typeof checkAccessRules>>
  >();
  const admissible: {
    url: string;
    protocolType: ReturnType<typeof getProtocolType>;
    isRawIpTarget: boolean;
    categoriesTotal: number;
  }[] = [];
  // Verified-ownership answers, cached per registrable domain for this
  // request. Only consulted when a URL's target bucket is already exhausted,
  // and a batch is usually many paths on a handful of domains, so this is at
  // most a query or two rather than one per URL.
  const ownershipCache = new Map<string, boolean>();
  for (const scanUrl of urlsToScan) {
    const targetRejection = await validateBulkTarget(scanUrl, accessRuleCache);
    if (targetRejection) {
      results.push(targetRejection);
      continue;
    }
    // Per-target volume, shared across all accounts. Counted once per URL,
    // which is the right granularity: a 100-URL batch really is 100 scans
    // aimed at whatever domains those URLs name. A verified owner of the
    // domain is exempt. ref: AUDIT-012#abuse-05
    const targetLimit = await checkTargetScanLimit(scanUrl);
    if (!targetLimit.allowed) {
      let ownsTarget = ownershipCache.get(targetLimit.rootDomain);
      if (ownsTarget === undefined) {
        ownsTarget = await isUrlOwnedByUser(scanUrl, authedUserId!);
        ownershipCache.set(targetLimit.rootDomain, ownsTarget);
      }
      if (!ownsTarget) {
        results.push({
          url: scanUrl,
          success: false,
          error: targetScanLimitMessage(targetLimit.rootDomain),
        });
        continue;
      }
    }
    const isRawIpTarget = isRawIpv4(scanUrl);
    // Progress denominator, computed from exactly what will run, never
    // estimated -- the same derivation POST /api/v3/scan does, so a bulk
    // scan's progress bar behaves identically to a single scan's.
    const categoriesTotal =
      (isRawIpTarget ? [] : getPlannedSyncCategories(null)).length +
      getPlannedAsyncBranches(scanUrl, null).length;
    admissible.push({
      url: scanUrl,
      protocolType: getProtocolType(scanUrl),
      isRawIpTarget,
      categoriesTotal,
    });
  }

  if (admissible.length === 0) {
    return NextResponse.json(
      buildResponseBody(validUrls.length, results, skippedUrls),
    );
  }

  // Reserve the concurrency capacity and insert one 'pending' row per
  // admitted URL in a single locked transaction, the same way POST
  // /api/v3/scan reserves its one row. Every URL now has an id the caller can
  // poll on GET /api/v3/scan/status/[id] and a row that shows up in history
  // immediately, instead of appearing only once the whole batch had finished.
  let reservation: Awaited<ReturnType<typeof reserveConcurrentScanBatch>>;
  try {
    reservation = await reserveConcurrentScanBatch(
      authedUserId!,
      async (client: PoolClient) => {
        const ids: number[] = [];
        for (const target of admissible) {
          const inserted = await client.query(
            `INSERT INTO scan_history
               (user_id, url, source, notes, status, started_at, categories_total, is_public, team_id)
             VALUES ($1, $2, $3, $4, 'pending', NOW(), $5, $6, $7)
             RETURNING id`,
            [
              authedUserId,
              target.url,
              isApiKeyAuth ? "api" : "web",
              DEFAULT_SCAN_NOTE,
              target.categoriesTotal,
              requestedIsPublic,
              teamAssignment.primaryTeamId,
            ],
          );
          const insertedId = inserted.rows[0]?.id;
          if (!insertedId) throw new Error("Insert returned no id");
          ids.push(insertedId as number);
        }
        return ids;
      },
    );
  } catch (err) {
    console.error(
      `[${APP_NAME}] Failed to create bulk scan_history rows:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: "Failed to start the scans. Please try again." },
      { status: 500 },
    );
  }

  if (!reservation.ok) {
    // Same body shape POST /api/v3/scan returns for the same condition, so an
    // API client keying on statusCode handles both identically.
    return NextResponse.json(
      { error: reservation.check.message, statusCode: "CONCURRENT_SCAN_LIMIT" },
      { status: 429 },
    );
  }

  // Every row of the batch carries the primary team from its INSERT; this
  // writes the rest of the set into scan_history_teams and is a no-op below
  // two teams.
  for (const scanId of reservation.scanIds) {
    await attachNewScanTeams(scanId, teamAssignment.teamIds);
  }

  // perf: resolve the plan's daily cap ONCE for the batch. The per-URL charge
  // below is still the same atomic capped increment, so the TOCTOU race it
  // closes stays closed; what is hoisted is only the plan lookup that used to
  // run inside it, which cost two or three queries per URL to return the same
  // number 100 times (AUDIT-012#perf-18).
  const batchDailyLimit = await getDailyLimit(authedUserId!);

  // Charge each reserved scan, in the same order the batch will run. Charging
  // AFTER the row exists mirrors POST /api/v3/scan (validate, reserve, then
  // charge): a request rejected by the concurrency gate above must not have
  // consumed any of the account's daily allowance, since there is no refund
  // path. A URL whose charge is refused has its row closed out as failed
  // rather than left 'pending', so it never holds a slot or shows as stuck.
  const queued: BulkQueuedScan[] = [];
  let lastApiKeyRateLimit: Awaited<
    ReturnType<typeof checkApiKeyRateLimit>
  > | null = null;
  for (let i = 0; i < admissible.length; i++) {
    const target = admissible[i];
    const scanId = reservation.scanIds[i];

    const dailyQuota = await incrementDailyCountCapped(
      authedUserId!,
      batchDailyLimit,
    );
    let refusal: string | null = dailyQuota.recorded
      ? null
      : DAILY_LIMIT_MESSAGE;

    if (
      !refusal &&
      isApiKeyAuth &&
      apiKeyId !== null &&
      typeof apiKeyDailyLimit === "number"
    ) {
      // Consume one rate-limit slot per URL scanned (prevents 100x
      // amplification where a single bulk call counted as only 1 slot
      // regardless of URL count).
      lastApiKeyRateLimit = await checkApiKeyRateLimit(
        apiKeyId,
        apiKeyDailyLimit,
      );
      if (!lastApiKeyRateLimit.allowed) {
        refusal = "API key daily limit reached mid-batch.";
      }
    }

    if (refusal) {
      // This URL and every one after it: the limit that just refused this one
      // refuses the rest of the batch too, so close them all out at once
      // instead of issuing a doomed charge per remaining URL.
      const abandoned = reservation.scanIds.slice(i);
      await Promise.all(
        abandoned.map((id) =>
          finalizeScanFailure(id, refusal!).catch(() => {}),
        ),
      );
      for (let j = i; j < admissible.length; j++) {
        results.push({
          url: admissible[j].url,
          success: false,
          error: refusal,
        });
      }
      break;
    }

    queued.push({
      scanId,
      url: target.url,
      normalizedUrl: target.url,
      protocolType: target.protocolType,
      isRawIpTarget: target.isRawIpTarget,
      categoriesTotal: target.categoriesTotal,
    });
    results.push({ url: target.url, success: true, scanId, status: "queued" });
  }

  // Kick off the real work detached from this request's lifecycle, exactly as
  // POST /api/v3/scan does. This is what makes the endpoint usable from a
  // browser at all: a 10-URL batch used to hold the request open for minutes
  // while a proxy in front of the app cut the connection at 100s and the scans
  // kept running unobserved. ref: AUDIT-011#drift-06
  if (queued.length > 0) {
    const bulkScanTimeoutSeconds = await getSetting(
      "BULK_SCAN_TIMEOUT_SECONDS",
    );
    void runBulkBatch({
      scans: queued,
      authedUserId: authedUserId!,
      timeoutSeconds: bulkScanTimeoutSeconds,
    }).catch((err) => {
      console.error(
        `[${APP_NAME}] Bulk batch dispatch failed:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  const responseData = buildResponseBody(
    validUrls.length,
    results,
    skippedUrls,
  );

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

/**
 * The batch response. `queued` replaces the old `successful` count: the
 * request now returns before any scan has run, so how many SUCCEEDED is not
 * knowable here. Each queued entry carries the scan id to poll on GET
 * /api/v3/scan/status/[id].
 *
 * `skippedUrls` are the URLs sliced off the front of the batch because the
 * account's remaining daily quota could not cover the whole submission. They
 * are appended last so they always sort after the URLs that were admitted.
 */
function buildResponseBody(
  total: number,
  results: BulkResultEntry[],
  skippedUrls: string[],
) {
  const allResults: BulkResultEntry[] = [
    ...results,
    ...skippedUrls.map((url): BulkResultEntry => ({
      url,
      success: false,
      error: DAILY_LIMIT_MESSAGE,
    })),
  ];
  return {
    total,
    queued: allResults.filter((r) => r.success).length,
    failed: allResults.filter((r) => !r.success).length,
    skipped: skippedUrls.length,
    results: allResults,
  };
}
