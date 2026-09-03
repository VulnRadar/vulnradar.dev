import { NextRequest } from "next/server";
import { BROWSERBASE_ENABLED } from "@/lib/config/server-constants";
import { getSettings } from "@/lib/config/runtime-config";
import {
  BrowserBaseError,
  createBrowserSession,
  endBrowserSession,
  getBrowserLiveUrls,
  getBrowserSession,
  navigateBrowserSession,
  pickLiveViewerUrl,
} from "@/lib/browserbase/client";
import { stopLiveNetworkCapture } from "@/lib/browserbase/network-capture";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { getSession } from "@/lib/auth";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import {
  checkBrowserbaseQuota,
  recordBrowserbaseSeconds,
} from "@/lib/billing/browserbase-usage";
import {
  acquireConcurrencySlot,
  releaseConcurrencySlot,
} from "@/lib/browserbase/concurrency-queue";
import { getUserPlan } from "@/lib/rate-limiting/daily-limits";
import pool from "@/lib/database/db";

interface CreateBody {
  url?: string;
  ttlSeconds?: number;
  ttl?: number;
  viewport?: { width: number; height: number };
}

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?::\d+)?(?:\/.*)?$/;

async function pickTimeout(body: CreateBody): Promise<number> {
  const { BROWSERBASE_MAX_TTL_SECONDS, BROWSERBASE_DEFAULT_TTL_SECONDS } =
    await getSettings([
      "BROWSERBASE_MAX_TTL_SECONDS",
      "BROWSERBASE_DEFAULT_TTL_SECONDS",
    ] as const);
  const requested =
    typeof body.ttlSeconds === "number"
      ? body.ttlSeconds
      : typeof body.ttl === "number"
        ? body.ttl
        : BROWSERBASE_DEFAULT_TTL_SECONDS;
  return Math.max(30, Math.min(requested, BROWSERBASE_MAX_TTL_SECONDS));
}

export const POST = withErrorHandling(async (request: Request) => {
  if (!BROWSERBASE_ENABLED) {
    return ApiResponse.error(
      "BrowserBase is not configured on this server.",
      503,
    );
  }
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }

  // rate-limit: cap BrowserBase session creation per authenticated
  // user. BrowserBase is a paid metered service — without this cap
  // a compromised session cookie can rack up real costs by spawning
  // unlimited sessions.
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `browser-session:${session.userId}`,
    ...RATE_LIMITS.browserSession,
  });
  if (!rl.allowed) {
    return ApiResponse.tooManyRequests(
      `Too many BrowserBase sessions. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      rl.retryAfterSeconds,
    );
  }
  void ip; // ip reserved for future per-IP layering

  // Plan quota: a live-browser session is a real, metered third-party cost
  // (see lib/billing/browserbase-usage.ts), separate from the rate limit
  // above, which only bounds abuse rate, not how much of the plan's actual
  // monthly minute allowance is left.
  const quota = await checkBrowserbaseQuota(session.userId);
  if (!quota.allowed) {
    return ApiResponse.error(
      quota.message || "Browserbase minute quota exceeded.",
      402,
    );
  }

  const parsed = await parseBody<CreateBody>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { url } = parsed.data;
  if (url !== undefined && url !== "" && url.trim()) {
    const trimmed = url.trim();
    const isHttp = /^https?:\/\//i.test(trimmed);
    const isIp = IPV4_REGEX.test(trimmed);
    if (!isHttp && !isIp) {
      return ApiResponse.badRequest(
        "url must be a public http(s) URL or a public IPv4 address",
      );
    }
    const safety = await validateScanTarget(trimmed);
    if (!safety.safe) {
      return ApiResponse.error(
        safety.reason || "Refusing to open a browser on this target.",
        400,
      );
    }
  }
  const timeout = await pickTimeout(parsed.data);
  // Default to 1920×1080 so the remote browser renders at a standard resolution.
  // BrowserBase's own default is much larger, which makes everything appear
  // tiny when the DevTools viewer is embedded in a 1920×1080 popup.
  const viewport = parsed.data.viewport ?? { width: 1920, height: 1080 };

  // Global concurrency cap + queue: this account's own Browserbase plan has
  // a real ceiling on how many sessions can run at once across every user
  // combined, separate from any one user's monthly minute allowance. Paid
  // plans are admitted ahead of free when both are waiting for the same
  // freed slot. A slot acquired here MUST be released on every path below
  // that does NOT end in a real, tracked session (see the catch block and
  // the "no id" branch) -- otherwise it leaks and the cap silently shrinks.
  const plan = await getUserPlan(session.userId);
  const slot = await acquireConcurrencySlot(plan !== "free");
  if (!slot.acquired) {
    return ApiResponse.error(
      "Live-browser capacity is full right now. Try again in a moment.",
      503,
    );
  }

  // Isolated from the try/catch below: any failure here means no real
  // session was ever created, so the slot reserved above must be released.
  // A failure AFTER this point means a real Browserbase session (and a
  // real concurrency slot) genuinely exists regardless of what our own
  // bookkeeping code does next, so the slot must stay held until the
  // session actually ends (its DELETE handler, or the periodic cleanup
  // sweep reclaiming one nobody explicitly closed).
  let created: Awaited<ReturnType<typeof createBrowserSession>>;
  try {
    created = await createBrowserSession({
      timeoutSeconds: timeout,
      viewport,
      keepAlive: true,
    });
    if (!created.id) {
      await releaseConcurrencySlot();
      return ApiResponse.error(
        "BrowserBase returned a session with no id.",
        502,
      );
    }
  } catch (err) {
    await releaseConcurrencySlot();
    if (err instanceof BrowserBaseError) {
      return ApiResponse.error(err.message, err.status);
    }
    throw err;
  }

  try {
    // Navigate to the target URL via CDP (fire-and-forget).
    // Browserbase has no REST "startUrl" param — CDP is the only way to
    // control navigation after session creation. Errors are swallowed
    // inside navigateBrowserSession; failure must never block the response.
    const targetUrl = url?.trim() || "";
    if (targetUrl && created.connectUrl) {
      const navigateUrl = /^https?:\/\//i.test(targetUrl)
        ? targetUrl
        : `http://${targetUrl}`;
      void navigateBrowserSession(created.connectUrl, navigateUrl);
    }

    // Record ownership BEFORE returning success (AUDIT-004#idor-01). This row
    // is the single source of truth for three things: GET/DELETE ownership
    // enforcement, releasing the concurrency slot acquired above, and billing
    // the session's metered seconds (the DELETE handler and the cleanup sweep
    // both key off it via RETURNING). If it never persisted, the session would
    // run unowned, its slot would leak until process restart, and its seconds
    // would never be billed. So a failed insert must tear the session back down
    // and fail the request, not fire-and-forget past it.
    const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();
    try {
      await pool.query(
        "INSERT INTO browser_sessions (id, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [created.id, session.userId, expiresAt],
      );
    } catch (insertErr) {
      console.error(
        "[browser/sessions] Failed to record session ownership; tearing the session down to avoid a leaked slot:",
        insertErr instanceof Error ? insertErr.message : insertErr,
      );
      await endBrowserSession(created.id).catch(() => {});
      await releaseConcurrencySlot();
      return ApiResponse.error(
        "Could not start the browser session. Please try again.",
        500,
      );
    }

    const live = await getBrowserLiveUrls(created.id).catch(() => null);

    const viewerUrl = live ? pickLiveViewerUrl(live) : null;
    // Selectively take viewer URLs from live rather than blanket-spreading.
    // The /debug endpoint does not return id/expiresAt/status, so spreading
    // live would overwrite those fields with undefined.
    const sessionOut: Record<string, unknown> = {
      ...created,
      liveViewerUrl: viewerUrl,
      debuggerFullscreenUrl:
        live?.debuggerFullscreenUrl ?? created.debuggerFullscreenUrl,
      debuggerUrl: live?.debuggerUrl ?? created.debuggerUrl,
      wsUrl: live?.wsUrl ?? created.wsUrl,
      // Preserve the target URL so the popup sidebar can show it
      url: url?.trim() || created.url || "",
    };
    return ApiResponse.success({
      session: sessionOut,
      expiresInSeconds: timeout,
    });
  } catch (err) {
    if (err instanceof BrowserBaseError) {
      return ApiResponse.error(err.message, err.status);
    }
    throw err;
  }
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!BROWSERBASE_ENABLED) {
    return ApiResponse.error(
      "BrowserBase is not configured on this server.",
      503,
    );
  }
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return ApiResponse.badRequest("Missing session id.");

  // Ownership check (AUDIT-004#idor-01). FAIL CLOSED, the same rule and for
  // the same reason as the sibling logs route: a missing or unreadable
  // ownership row is denied, not served.
  //
  // This used to deny only when a row existed AND named someone else, so a
  // row-less session -- or a transient error on the SELECT, which
  // `.catch(() => null)` turns into "no row" -- skipped the check entirely and
  // fell through to the response below. That response carries wsUrl,
  // debuggerUrl and debuggerFullscreenUrl: interactive CDP control of a live
  // headless browser, which is strictly more than the network log the logs
  // route already refuses to fail open on. The allowance was written for a
  // transition window that has long since closed, and there are two ways a row
  // is genuinely absent while the remote session is still reachable: the
  // retention sweep in lib/database/cleanup.ts deletes on expires_at without
  // calling endBrowserSession, and any database hiccup lands in the catch
  // above. POST hard-fails the request when its ownership INSERT fails
  // (see the comment there), so no session this route should serve is ever
  // row-less.
  const ownerRow = await pool
    .query<{ user_id: number }>(
      "SELECT user_id FROM browser_sessions WHERE id = $1",
      [id],
    )
    .catch(() => null);
  if (
    !ownerRow ||
    ownerRow.rows.length === 0 ||
    ownerRow.rows[0].user_id !== session.userId
  ) {
    return ApiResponse.forbidden();
  }

  try {
    // Fetch metadata and debug (live viewer) URLs in parallel.
    // /v1/sessions/{id} returns status/region/expiry but NOT debuggerFullscreenUrl.
    // /v1/sessions/{id}/debug returns the iframe-embeddable viewer URL.
    // Both are needed so the browser viewer page can render the iframe correctly.
    const [data, live] = await Promise.all([
      getBrowserSession(id),
      getBrowserLiveUrls(id).catch(() => null),
    ]);
    const viewerUrl = live ? pickLiveViewerUrl(live) : null;
    // Spread data first, then selectively take viewer URLs from live.
    // Do NOT do a blanket spread of live — its expiresAt/id/status are
    // undefined (the /debug endpoint doesn't return them) and would
    // overwrite the real values from getBrowserSession.
    const sessionOut: Record<string, unknown> = {
      ...data,
      liveViewerUrl: viewerUrl,
      debuggerFullscreenUrl:
        live?.debuggerFullscreenUrl ?? data.debuggerFullscreenUrl,
      debuggerUrl: live?.debuggerUrl ?? data.debuggerUrl,
      wsUrl: live?.wsUrl ?? data.wsUrl,
    };
    return ApiResponse.success({ session: sessionOut });
  } catch (err) {
    if (err instanceof BrowserBaseError) {
      return ApiResponse.error(err.message, err.status);
    }
    throw err;
  }
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!BROWSERBASE_ENABLED) {
    return ApiResponse.error(
      "BrowserBase is not configured on this server.",
      503,
    );
  }
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return ApiResponse.badRequest("Missing session id.");

  // Ownership check (AUDIT-004#idor-01). created_at is fetched in the same
  // query so the plan-usage true-up below has a real elapsed duration to
  // record without a second round trip.
  //
  // FAIL CLOSED, matching GET above. The old predicate denied only a row that
  // named someone else, so a row-less session could be torn down by any signed-
  // in caller who knew its id. Nothing is lost by refusing: the row is absent
  // precisely because the retention sweep already reaped it past expires_at, by
  // which point Browserbase has ended the session on its own timeoutSeconds,
  // and both the concurrency-slot release and the usage true-up below key off
  // that same row, so a row-less DELETE never had anything left to do.
  const ownerRow = await pool
    .query<{ user_id: number; created_at: string }>(
      "SELECT user_id, created_at FROM browser_sessions WHERE id = $1",
      [id],
    )
    .catch(() => null);
  if (
    !ownerRow ||
    ownerRow.rows.length === 0 ||
    ownerRow.rows[0].user_id !== session.userId
  ) {
    return ApiResponse.forbidden();
  }

  await endBrowserSession(id);
  // Tear down the live network-capture CDP connection + buffer for this session.
  stopLiveNetworkCapture(id);
  // Clean up the ownership record AND make it the single source of truth for
  // billing: record usage only when THIS request's DELETE actually removed the
  // row (RETURNING). The scheduled cleanup pass (lib/database/cleanup.ts) also
  // deletes-and-records an expired session; without the row-deletion gate here,
  // an explicit DELETE racing that cleanup would double-count the seconds.
  const deleted = await pool
    .query<{ user_id: number; created_at: string }>(
      "DELETE FROM browser_sessions WHERE id = $1 RETURNING user_id, created_at",
      [id],
    )
    .catch(() => null);

  const deletedRow = deleted?.rows[0];
  if (deletedRow) {
    const elapsedSeconds = Math.max(
      0,
      Math.round(
        (Date.now() - new Date(deletedRow.created_at).getTime()) / 1000,
      ),
    );
    if (elapsedSeconds > 0) {
      // Swallowed so a usage write never fails the delete, but not silent:
      // browserbase seconds are what the account is metered on, so a
      // persistent failure would stop usage being counted for every account
      // while the operator's real bill kept growing, with no signal anywhere.
      recordBrowserbaseSeconds(deletedRow.user_id, elapsedSeconds).catch(
        (err) =>
          console.error(
            `[browser-sessions] Failed to record browserbase seconds for user ${deletedRow.user_id}:`,
            err,
          ),
      );
    }
    // Free the concurrency slot this session held, admitting the next
    // queued request (if any) immediately rather than waiting for its own
    // poll/timeout. Only sessions with a tracked row ever held a slot (see
    // POST's acquireConcurrencySlot) -- a row-less session predates
    // ownership tracking and never went through that reservation.
    // Swallowed so a metering hiccup never fails the delete, but logged: a
    // failing release leaks the global session slot permanently and queued
    // requests then wait out their timeout with nothing in the error log.
    releaseConcurrencySlot().catch((err) =>
      console.error(
        "[browser-sessions] Failed to release a concurrency slot:",
        err,
      ),
    );
  }

  return ApiResponse.success({ ended: true, id });
});
