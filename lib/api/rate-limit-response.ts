import { NextResponse } from "next/server";

import { ERROR_CODES, type ErrorCode } from "@/lib/api/error-codes";

/**
 * The 429 answers: a spent quota, a burst limiter, too many running scans.
 *
 * Its own module, importing nothing but NextResponse and the import-free code
 * registry, for the same reason lib/api/request-limits.ts is: lib/api/api-utils.ts
 * pulls in the database pool and the session helpers, so a route that only
 * wants this helper would end up dragging both into its import graph.
 */

/**
 * A Retry-After value a client can act on: whole seconds and at least 1.
 * Math.max(1, NaN) is NaN, so the guard has to come first or a bad input would
 * send `Retry-After: NaN`, which is worse than sending nothing.
 */
function retryAfterSeconds(seconds: number): string {
  return String(Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 1);
}

/**
 * The shape lib/api/api-keys.ts's checkRateLimit returns. Declared structurally
 * rather than imported so this module keeps its empty dependency list.
 */
export interface ApiKeyRateLimitState {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string;
}

/**
 * POST /scan and POST /scan/crawl have always answered a spent quota with the
 * full set of rate-limit headers plus a body carrying limit/used/remaining/
 * resets_at, while every history read answered the SAME limiter, hit by the
 * SAME key, with a bare `{ error }` and no Retry-After. A client cannot write
 * one retry path against that, and the "honour Retry-After" advice in the docs
 * was unfollowable on exactly the endpoints a polling client calls most.
 * ref: AUDIT-015#api-02
 *
 * Retry-After is derived from resetsAt and floored at 1: a reset timestamp that
 * has just passed must not tell a client to retry in zero or negative seconds.
 *
 * `code` says which budget ran out, because the headers cannot: the key's
 * request budget is the default, and the plan's daily scan quota passes
 * DAILY_LIMIT. `retryAfter` replaces the derived wait when the caller knows
 * better.
 */
export function rateLimitedResponse(
  state: ApiKeyRateLimitState,
  message = `Rate limit exceeded. ${state.limit} requests per 24 hours. Resets at ${state.resetsAt}`,
  options: { code?: ErrorCode; retryAfter?: number } = {},
): NextResponse {
  const wait =
    options.retryAfter ??
    (new Date(state.resetsAt).getTime() - Date.now()) / 1000;
  return NextResponse.json(
    {
      error: message,
      limit: state.limit,
      used: state.used,
      remaining: state.remaining,
      resets_at: state.resetsAt,
      code: options.code ?? "API_QUOTA_EXCEEDED",
    },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": String(state.limit),
        "X-RateLimit-Remaining": String(state.remaining),
        // Used and Policy match what the session path's getRateLimitHeaders
        // sends (lib/rate-limiting/daily-limits.ts). The Bearer path used to
        // omit both, so the docs' "every 429 carries the full five" was true of
        // neither path: the session one has all five but no Retry-After, and
        // the key one had Retry-After but only three of the five.
        "X-RateLimit-Used": String(state.used),
        "X-RateLimit-Reset": state.resetsAt,
        "X-RateLimit-Policy": "daily",
        "Retry-After": retryAfterSeconds(wait),
      },
    },
  );
}

/**
 * A burst limiter's refusal. `extra` goes last so a limiter with a code of its
 * own (BULK_RATE_LIMIT, TARGET_RATE_LIMIT) can name it, and so a route keeps
 * any key its clients already read.
 */
export function burstLimitedResponse(
  rl: { retryAfterSeconds: number },
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: message, code: "RATE_LIMITED", ...extra },
    {
      status: 429,
      headers: { "Retry-After": retryAfterSeconds(rl.retryAfterSeconds) },
    },
  );
}

/**
 * Too many scans already running. The wait is fixed rather than computed
 * because nothing knows when a running scan will finish; a short poll is the
 * honest answer. statusCode is the key v3 clients already branch on.
 */
export function concurrentScanLimitResponse(
  message: string | undefined,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      error: message ?? ERROR_CODES.CONCURRENT_SCAN_LIMIT.meaning,
      statusCode: "CONCURRENT_SCAN_LIMIT",
      code: "CONCURRENT_SCAN_LIMIT",
      ...extra,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(ERROR_CODES.CONCURRENT_SCAN_LIMIT.retryAfter),
      },
    },
  );
}
