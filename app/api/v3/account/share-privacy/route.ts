import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * GET/PUT /api/v3/account/share-privacy
 *
 * The account-level "list new shares in Public Scans by default" setting
 * (users.share_publicly_listed_by_default -- see instrumentation.ts). Read
 * by lib/scanner/share-privacy.ts's resolveSharePubliclyListed whenever a
 * NEW share link is created and the request doesn't say one way or the
 * other, and by the Privacy tab (components/profile/tabs/
 * profile-privacy-tab.tsx) to show/set it.
 *
 * Deliberately a separate route from /api/v3/account/privacy (the
 * scans_private_by_default setting): that one is about the per-host public
 * cache at /host/[hostname], this one is about the /public-scans directory.
 * Two independent privacy mechanisms, two independent settings.
 */

// GET: fetch the current setting
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const result = await pool.query<{
    share_publicly_listed_by_default: boolean;
  }>("SELECT share_publicly_listed_by_default FROM users WHERE id = $1", [
    session.userId,
  ]);

  return ApiResponse.success({
    sharePubliclyListedByDefault:
      result.rows[0]?.share_publicly_listed_by_default ?? true,
  });
});

// PUT: update the setting
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const parsed = await parseBody<{ sharePubliclyListedByDefault?: unknown }>(
    request,
  );
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  if (typeof parsed.data.sharePubliclyListedByDefault !== "boolean") {
    return ApiResponse.badRequest(
      "sharePubliclyListedByDefault must be a boolean.",
    );
  }

  const result = await pool.query<{
    share_publicly_listed_by_default: boolean;
  }>(
    "UPDATE users SET share_publicly_listed_by_default = $1 WHERE id = $2 RETURNING share_publicly_listed_by_default",
    [parsed.data.sharePubliclyListedByDefault, session.userId],
  );

  return ApiResponse.success({
    sharePubliclyListedByDefault:
      result.rows[0]?.share_publicly_listed_by_default ?? true,
  });
});
