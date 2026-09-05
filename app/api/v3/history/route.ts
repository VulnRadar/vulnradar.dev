import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { rateLimitedResponse } from "@/lib/api/rate-limit-response";
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  BEARER_PREFIX,
} from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
import { buildHistoryFilter } from "@/lib/history/list-filter";
import {
  validateApiKey,
  checkRateLimit as checkApiKeyRateLimit,
  recordUsage,
} from "@/lib/api/api-keys";
import {
  hasApiKeyScope,
  apiKeyScopeErrorMessage,
  API_KEY_SCOPES,
} from "@/lib/api/api-key-scopes";

// billing: mirrors lib/database/cleanup.ts's retention resolution, but
// applied to what this route READS/SHOWS rather than what it deletes --
// see the module comment on lib/billing/plan-limits.ts for why the
// registry (not lib/billing/catalog.ts) is the source of truth here.
const RETENTION_SETTING_KEYS: Record<string, SettingKey> = {
  free: "BILLING_FREE_RETENTION",
  core_supporter: "BILLING_CORE_SUPPORTER_RETENTION",
  pro_supporter: "BILLING_PRO_SUPPORTER_RETENTION",
  elite_supporter: "BILLING_ELITE_SUPPORTER_RETENTION",
};

/**
 * Read `limit` / `offset` off the query string.
 *
 * The list has always been hard-capped at HISTORY_LIST_MAX_ROWS and has always
 * reported `total` and `truncated: true` alongside it, so an API client with
 * more scans than the cap was told there was more and given no way to ask for
 * it: page 2 did not exist (AUDIT-015#api-01). The web UI paginates in the
 * browser over the rows it already has, which is why this never showed up
 * there.
 *
 * Both parameters are optional and absence is the previous behaviour exactly
 * (first page, cap-sized), so no existing caller changes. An out-of-range or
 * unparseable value is clamped rather than rejected: this is a read, and a
 * 400 for `?limit=0` would be a worse answer than the first page.
 */
function parsePaging(
  searchParams: URLSearchParams,
  maxRows: number,
): { limit: number; offset: number } {
  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), maxRows)
      : maxRows;

  const rawOffset = Number(searchParams.get("offset"));
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

/**
 * Read the optional `q` (URL substring) and `tag` filters off the query string.
 *
 * `search` is accepted as an alias for `q` because the web UI's control is
 * called Search and an API client guessing at the name will reach for one of
 * the two.
 *
 * Absence is the previous behaviour exactly (no filtering), and an empty or
 * whitespace-only value counts as absent rather than as "match nothing": a
 * cleared search box must return the list, not an empty one.
 */
function parseFilters(searchParams: URLSearchParams): {
  q: string | null;
  tag: string | null;
} {
  const rawQ = (
    searchParams.get("q") ??
    searchParams.get("search") ??
    ""
  ).trim();
  const rawTag = (searchParams.get("tag") ?? "").trim();
  return { q: rawQ || null, tag: rawTag || null };
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;
  let keyData: Awaited<ReturnType<typeof validateApiKey>> = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    keyData = await validateApiKey(token);

    if (!keyData) {
      return ApiResponse.unauthorized("Invalid or revoked API key.");
    }
    if (keyData.needsTermsAcceptance) {
      return ApiResponse.error(
        "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        403,
      );
    }

    // scoping: reading history requires scan:read.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_READ)) {
      return ApiResponse.forbidden(
        apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_READ),
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }

    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    }
    authedUserId = session.userId;
  }

  if (!authedUserId) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // Get user's plan and role to determine history retention from the
  // live admin-configured settings (database ?? env ?? shipped default),
  // not the compiled BILLING_HISTORY_RETENTION table -- otherwise an
  // admin-edited retention window would keep showing the old value here
  // even though lib/database/cleanup.ts is already deleting on the new one.
  const userRes = await pool.query(
    "SELECT plan, role FROM users WHERE id = $1",
    [authedUserId],
  );
  const userPlan = userRes.rows[0]?.plan || "free";
  const userRole = userRes.rows[0]?.role || "user";

  // Staff/admin always get unlimited retention regardless of plan
  const isStaff = ["admin", "moderator", "support"].includes(userRole);
  const retentionSettingKey =
    RETENTION_SETTING_KEYS[userPlan] ?? RETENTION_SETTING_KEYS.free;
  const retentionSettings = await getSettings([
    retentionSettingKey,
    "HISTORY_LIST_MAX_ROWS",
  ] as const);
  const retentionDays = isStaff
    ? -1
    : Number(retentionSettings[retentionSettingKey]);
  const historyMaxRows = Number(retentionSettings.HISTORY_LIST_MAX_ROWS);
  const { limit: pageLimit, offset: pageOffset } = parsePaging(
    request.nextUrl.searchParams,
    historyMaxRows,
  );

  // Search and tag filtering run in SQL, over the whole retention window, and
  // the clause is built by lib/history/list-filter.ts so tests/integration can
  // run this exact WHERE against a real PostgreSQL. Both filters are appended
  // to the user-scoped clause the unfiltered list already used, never
  // substituted for it, so a filter can only narrow the caller's own rows.
  const { q, tag } = parseFilters(request.nextUrl.searchParams);
  const {
    baseWhere,
    baseParams,
    where: listWhere,
    params: listParams,
    filtering,
  } = buildHistoryFilter({
    userId: authedUserId,
    retentionDays,
    q,
    tag,
  });

  // sh.status is projected so the list can distinguish a finished scan from
  // one that is still pending/running or that failed. The row is inserted as
  // 'pending' before any work starts, with summary '{}', findings_count 0 and
  // duration 0, so a scan the user navigated away from used to appear in
  // History wearing a clean result's clothes: "0 findings in 0.0s".
  const result = await pool.query(
    `SELECT sh.public_id AS id, sh.url, sh.summary, sh.findings_count, sh.duration, sh.scanned_at, sh.source, sh.status,
         COALESCE(
           (SELECT json_agg(json_build_object('tag', st.tag, 'source', st.source) ORDER BY st.source, st.tag)
            FROM scan_tags st WHERE st.scan_id = sh.id AND st.user_id = $1),
           '[]'::json
         ) as tags
       FROM scan_history sh
       WHERE ${listWhere}
       ORDER BY sh.scanned_at DESC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
    [...listParams, pageLimit, pageOffset],
  );

  // The list above is capped at HISTORY_LIST_MAX_ROWS, so scans.length is a
  // page size, not an account total. Returning the real count alongside it
  // stops the client presenting the cap as the total, which is what made the
  // "delete all history" confirmation understate what the DELETE below
  // actually removes (the DELETE is deliberately unbounded).
  // Degrades to the page size rather than failing the request: an operator
  // losing the exact total is a far better outcome than the whole history
  // page 500ing, and the count is advisory.
  let total = result.rows.length;
  try {
    const totalRes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
           FROM scan_history sh
           WHERE ${baseWhere}`,
      baseParams,
    );
    total = totalRes?.rows?.[0]?.n ?? result.rows.length;
  } catch (err) {
    console.error(
      "[history] total count failed, falling back to page size",
      err,
    );
  }

  // How many rows the filters match across the whole retention window, which
  // is the number this page's pagination is about. Without a filter it is the
  // account total and no second count is issued. It is reported separately
  // from `total` on purpose: `total` is what the delete-everything
  // confirmation counts, and a filtered number there would understate what the
  // unbounded DELETE removes.
  let matched = total;
  if (filtering) {
    matched = pageOffset + result.rows.length;
    try {
      const matchedRes = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM scan_history sh
           WHERE ${listWhere}`,
        listParams,
      );
      matched = matchedRes?.rows?.[0]?.n ?? matched;
    } catch (err) {
      console.error(
        "[history] filtered count failed, falling back to page size",
        err,
      );
    }
  }

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  return ApiResponse.success({
    scans: result.rows,
    total,
    matched,
    // Echoed back so a client can tell what the server actually filtered on
    // rather than assuming its request arrived intact.
    q,
    tag,
    // The page size actually applied, not the ceiling: a caller that asked for
    // ?limit=10 was previously told `limit: 100` because this reported the cap
    // rather than the number of rows it was willing to return.
    limit: pageLimit,
    offset: pageOffset,
    maxLimit: historyMaxRows,
    // "There are rows after this page", measured against the filtered set so
    // paging works through a search rather than through the whole account.
    // With no filter, matched === total and this is the same boolean it has
    // always been.
    truncated: pageOffset + result.rows.length < matched,
  });
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization");
  let authedUserId: number | null = null;
  let apiKeyId: number | null = null;
  let keyData: Awaited<ReturnType<typeof validateApiKey>> = null;

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7);
    keyData = await validateApiKey(token);

    if (!keyData) {
      return ApiResponse.unauthorized("Invalid or revoked API key.");
    }
    if (keyData.needsTermsAcceptance) {
      return ApiResponse.error(
        "Please accept our updated Terms of Service. Log in to your account to review and accept the new terms before using the API.",
        403,
      );
    }

    // scoping: clearing all scan history is destructive -- requires
    // scan:delete, deliberately excluded from a newly created key's default
    // scopes.
    if (!hasApiKeyScope(keyData.scopes, API_KEY_SCOPES.SCAN_DELETE)) {
      return ApiResponse.forbidden(
        apiKeyScopeErrorMessage(API_KEY_SCOPES.SCAN_DELETE),
      );
    }

    // Check API key rate limit
    const rateLimit = await checkApiKeyRateLimit(
      keyData.keyId,
      keyData.dailyLimit,
    );
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit);
    }

    apiKeyId = keyData.keyId;
    authedUserId = keyData.userId;
  } else {
    const session = await getSession();
    if (!session) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
    }
    authedUserId = session.userId;
  }

  if (!authedUserId) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // Scoped to the same "not a GitHub repo scan" set the GET above lists,
  // so "Clear history" only clears URL-scan history -- repo scan history
  // (its own thing at /repos) survives a URL-history wipe.
  await pool.query(
    `DELETE FROM scan_tags WHERE user_id = $1 AND scan_id IN (
       SELECT id FROM scan_history
       WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')
     )`,
    [authedUserId],
  );
  await pool.query(
    `DELETE FROM scan_history
     WHERE user_id = $1 AND (scan_type IS NULL OR scan_type != 'github')`,
    [authedUserId],
  );

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  return ApiResponse.success({ message: SUCCESS_MESSAGES.DELETED });
});
