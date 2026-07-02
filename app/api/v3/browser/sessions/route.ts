import { NextRequest } from "next/server";
import {
  BROWSERBASE_ENABLED,
  BROWSERBASE_MAX_TTL_SECONDS,
  BROWSERBASE_DEFAULT_TTL_SECONDS,
} from "@/lib/config/constants";
import {
  BrowserBaseError,
  createBrowserSession,
  endBrowserSession,
  getBrowserLiveUrls,
  getBrowserSession,
  navigateBrowserSession,
  pickLiveViewerUrl,
} from "@/lib/browserbase/client";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { getSession } from "@/lib/auth";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import pool from "@/lib/database/db";

interface CreateBody {
  url?: string;
  ttlSeconds?: number;
  ttl?: number;
  viewport?: { width: number; height: number };
}

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?::\d+)?(?:\/.*)?$/;

function pickTimeout(body: CreateBody): number {
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
  const timeout = pickTimeout(parsed.data);
  // Default to 1920×1080 so the remote browser renders at a standard resolution.
  // BrowserBase's own default is much larger, which makes everything appear
  // tiny when the DevTools viewer is embedded in a 1920×1080 popup.
  const viewport = parsed.data.viewport ?? { width: 1920, height: 1080 };
  try {
    const created = await createBrowserSession({
      timeoutSeconds: timeout,
      viewport,
      keepAlive: true,
    });
    if (!created.id) {
      return ApiResponse.error(
        "BrowserBase returned a session with no id.",
        502,
      );
    }

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

    // Record ownership so GET/DELETE can enforce it (AUDIT-004#idor-01).
    // Fire-and-forget — if the insert fails the session still works but
    // ownership enforcement will fail-open for this session only.
    const expiresAt = new Date(Date.now() + timeout * 1000).toISOString();
    pool
      .query(
        "INSERT INTO browser_sessions (id, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [created.id, session.userId, expiresAt],
      )
      .catch(() => {});

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

  // Ownership check: if a browser_sessions row exists and it belongs to
  // a different user, deny the request (AUDIT-004#idor-01). Rows created
  // before this check was introduced won't exist in the table — those
  // sessions are allowed (fail-open for the brief transition window).
  const ownerRow = await pool
    .query<{ user_id: number }>(
      "SELECT user_id FROM browser_sessions WHERE id = $1",
      [id],
    )
    .catch(() => null);
  if (
    ownerRow &&
    ownerRow.rows.length > 0 &&
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

  // Ownership check (AUDIT-004#idor-01).
  const ownerRow = await pool
    .query<{ user_id: number }>(
      "SELECT user_id FROM browser_sessions WHERE id = $1",
      [id],
    )
    .catch(() => null);
  if (
    ownerRow &&
    ownerRow.rows.length > 0 &&
    ownerRow.rows[0].user_id !== session.userId
  ) {
    return ApiResponse.forbidden();
  }

  await endBrowserSession(id);
  // Clean up the ownership record when the session ends.
  pool
    .query("DELETE FROM browser_sessions WHERE id = $1", [id])
    .catch(() => {});
  return ApiResponse.success({ ended: true, id });
});
