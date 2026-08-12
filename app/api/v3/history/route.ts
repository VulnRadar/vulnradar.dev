import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  BEARER_PREFIX,
} from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import type { SettingKey } from "@/lib/config/registry";
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
      return ApiResponse.error(
        `Rate limit exceeded. Daily limit reached. Resets at ${rateLimit.resetsAt}`,
        429,
      );
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

  // GitHub repo scans (sh.scan_type = 'github') are excluded here: they get
  // their own dedicated history at /repos (app/api/v3/scan/github/history),
  // scoped per-repo instead of mixed into this URL-scan list. See the
  // matching exclusion in this route's DELETE handler below.
  const result = await pool.query(
    retentionDays <= 0
      ? `SELECT sh.id, sh.url, sh.summary, sh.findings_count, sh.duration, sh.scanned_at, sh.source,
         COALESCE(
           (SELECT json_agg(json_build_object('tag', st.tag, 'source', st.source) ORDER BY st.source, st.tag)
            FROM scan_tags st WHERE st.scan_id = sh.id AND st.user_id = $1),
           '[]'::json
         ) as tags
       FROM scan_history sh
       WHERE sh.user_id = $1 AND (sh.scan_type IS NULL OR sh.scan_type != 'github')
       ORDER BY sh.scanned_at DESC
       LIMIT $2`
      : `SELECT sh.id, sh.url, sh.summary, sh.findings_count, sh.duration, sh.scanned_at, sh.source,
         COALESCE(
           (SELECT json_agg(json_build_object('tag', st.tag, 'source', st.source) ORDER BY st.source, st.tag)
            FROM scan_tags st WHERE st.scan_id = sh.id AND st.user_id = $1),
           '[]'::json
         ) as tags
       FROM scan_history sh
       WHERE sh.user_id = $1 AND (sh.scan_type IS NULL OR sh.scan_type != 'github')
         AND sh.scanned_at > NOW() - ($2 * INTERVAL '1 day')
       ORDER BY sh.scanned_at DESC
       LIMIT $3`,
    retentionDays <= 0
      ? [authedUserId, historyMaxRows]
      : [authedUserId, Math.floor(retentionDays), historyMaxRows],
  );

  // Record API key usage
  if (apiKeyId) {
    await recordUsage(apiKeyId);
  }

  return ApiResponse.success({ scans: result.rows });
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
      return ApiResponse.error(
        `Rate limit exceeded. Daily limit reached. Resets at ${rateLimit.resetsAt}`,
        429,
      );
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
