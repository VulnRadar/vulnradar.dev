import { NextResponse } from "next/server";

/**
 * The one 429 answer for a spent per-key daily quota.
 *
 * Its own module, importing nothing but NextResponse, for the same reason
 * lib/api/request-limits.ts is: lib/api/api-utils.ts pulls in the database pool
 * and the session helpers, so a route that only wants this helper would end up
 * dragging both into its import graph.
 */

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
 */
export function rateLimitedResponse(
  state: ApiKeyRateLimitState,
  message = `Rate limit exceeded. ${state.limit} requests per 24 hours. Resets at ${state.resetsAt}`,
): NextResponse {
  // Math.max(1, NaN) is NaN, so an unparseable resetsAt would emit
  // `Retry-After: NaN` -- a header no client can act on, and worse than none.
  const secondsUntilReset = Math.ceil(
    (new Date(state.resetsAt).getTime() - Date.now()) / 1000,
  );
  const retryAfter = Number.isFinite(secondsUntilReset)
    ? Math.max(1, secondsUntilReset)
    : 1;
  return NextResponse.json(
    {
      error: message,
      limit: state.limit,
      used: state.used,
      remaining: state.remaining,
      resets_at: state.resetsAt,
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
        "Retry-After": String(retryAfter),
      },
    },
  );
}
