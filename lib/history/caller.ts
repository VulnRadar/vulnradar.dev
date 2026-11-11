import type { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/lib/api/api-utils";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import type { ApiKeyScope } from "@/lib/api/api-key-scopes";
import {
  UNLIMITED_API_KEY_DAILY_LIMIT,
  checkRateLimit,
  recordUsage,
} from "@/lib/api/api-keys";
import { parseBearer } from "@/lib/api/bearer";
import {
  rateLimitedResponse,
  type ApiKeyRateLimitState,
} from "@/lib/api/rate-limit-response";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * Who is calling a history route, and what their key has left.
 *
 * Every history handler opened with the same sixty lines: read the Bearer
 * header, validate the key, refuse an account behind on the Terms, check the
 * scope, charge the key's budget, and otherwise fall back to the session
 * cookie. They differ only in the scope they ask for, so that is the one
 * argument here.
 */
export interface HistoryCaller {
  userId: number;
  /** Null for a session caller. */
  apiKeyId: number | null;
  /** What the key's budget looked like after this request was charged. */
  budget: ApiKeyRateLimitState | null;
}

export type HistoryCallerResult =
  { ok: true; caller: HistoryCaller } | { ok: false; response: NextResponse };

/**
 * A Bearer header means a key call and is never retried as a session: a bad
 * key is a 401, not a fall-through to whatever cookie the client also sent.
 * Without one the session cookie decides.
 */
export async function authenticateHistoryCaller(
  request: Request,
  scope: ApiKeyScope,
): Promise<HistoryCallerResult> {
  if (parseBearer(request.headers.get("authorization")) !== null) {
    const auth = await authenticateApiKey(request, { scope });
    if (!auth.ok) return auth;

    const budget = await checkRateLimit(auth.auth.keyId, auth.auth.dailyLimit);
    if (!budget.allowed) {
      return { ok: false, response: rateLimitedResponse(budget) };
    }
    return {
      ok: true,
      caller: {
        userId: auth.auth.userId,
        apiKeyId: auth.auth.keyId,
        budget,
      },
    };
  }

  const session = await getSession();
  if (!session) return { ok: false, response: unauthenticated(request) };
  return {
    ok: true,
    caller: { userId: session.userId, apiKeyId: null, budget: null },
  };
}

export function unauthenticated(request: Request): NextResponse {
  return ApiResponse.fail({
    code: "UNAUTHENTICATED",
    message: ERROR_MESSAGES.UNAUTHORIZED,
    status: 401,
    request,
  });
}

/**
 * The X-RateLimit-* set for a key's request budget, a rolling 24 hours. The
 * plan's scan quota is a different budget and is never reported here: a
 * client that reads these headers must be able to rely on them describing one
 * thing. An unlimited key omits Limit and Remaining rather than sending the
 * 999999 stand-in.
 */
export function keyBudgetHeaders(
  budget: ApiKeyRateLimitState,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Used": String(budget.used),
    "X-RateLimit-Reset": budget.resetsAt,
    "X-RateLimit-Policy": "daily",
  };
  const unlimited =
    !Number.isFinite(budget.limit) ||
    budget.limit >= UNLIMITED_API_KEY_DAILY_LIMIT;
  if (!unlimited) {
    headers["X-RateLimit-Limit"] = String(budget.limit);
    headers["X-RateLimit-Remaining"] = String(budget.remaining);
  }
  return headers;
}

/**
 * Finish a successful key call: record the usage and put the budget headers
 * on the response. A session caller's response passes through untouched.
 */
export async function completeCall(
  caller: HistoryCaller,
  response: NextResponse,
): Promise<NextResponse> {
  if (caller.apiKeyId === null) return response;
  await recordUsage(caller.apiKeyId);
  if (caller.budget) {
    for (const [name, value] of Object.entries(
      keyBudgetHeaders(caller.budget),
    )) {
      response.headers.set(name, value);
    }
  }
  return response;
}
