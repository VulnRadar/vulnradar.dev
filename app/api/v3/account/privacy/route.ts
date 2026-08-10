import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * GET/PUT /api/v3/account/privacy
 *
 * The account-level "scans are private by default" setting (users.
 * scans_private_by_default -- see instrumentation.ts). Read by
 * lib/scanner/scan-privacy.ts's resolveScanIsPublic whenever a scan-creation
 * request doesn't say isPublic one way or the other, and by the Privacy tab
 * (components/profile/tabs/profile-privacy-tab.tsx) to show/set it.
 */

// GET: fetch the current setting
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const result = await pool.query<{ scans_private_by_default: boolean }>(
    "SELECT scans_private_by_default FROM users WHERE id = $1",
    [session.userId],
  );

  return ApiResponse.success({
    scansPrivateByDefault: result.rows[0]?.scans_private_by_default ?? false,
  });
});

// PUT: update the setting
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const parsed = await parseBody<{ scansPrivateByDefault?: unknown }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  if (typeof parsed.data.scansPrivateByDefault !== "boolean") {
    return ApiResponse.badRequest("scansPrivateByDefault must be a boolean.");
  }

  const result = await pool.query<{ scans_private_by_default: boolean }>(
    "UPDATE users SET scans_private_by_default = $1 WHERE id = $2 RETURNING scans_private_by_default",
    [parsed.data.scansPrivateByDefault, session.userId],
  );

  return ApiResponse.success({
    scansPrivateByDefault: result.rows[0]?.scans_private_by_default ?? false,
  });
});
