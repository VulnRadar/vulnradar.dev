import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * GET/PUT /api/v3/account/posture-digest
 *
 * The account-level opt-in for the periodic posture digest email
 * (users.digest_email_enabled -- see lib/notifications/digest-schema.ts and
 * lib/notifications/posture-digest.ts). Kept as its own users-table column
 * and route, same shape as /api/v3/account/privacy, rather than folded into
 * /api/v3/account/notifications: that route's notification_preferences
 * columns all default to opted-in, while this is a brand-new email category
 * that must default OFF so it never surprises an existing user who never
 * asked for it.
 */

// GET: fetch the current setting
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const result = await pool.query<{ digest_email_enabled: boolean }>(
    "SELECT digest_email_enabled FROM users WHERE id = $1",
    [session.userId],
  );

  return ApiResponse.success({
    digestEmailEnabled: result.rows[0]?.digest_email_enabled ?? false,
  });
});

// PUT: update the setting
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const parsed = await parseBody<{ digestEmailEnabled?: unknown }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);

  if (typeof parsed.data.digestEmailEnabled !== "boolean") {
    return ApiResponse.badRequest("digestEmailEnabled must be a boolean.");
  }

  const result = await pool.query<{ digest_email_enabled: boolean }>(
    "UPDATE users SET digest_email_enabled = $1 WHERE id = $2 RETURNING digest_email_enabled",
    [parsed.data.digestEmailEnabled, session.userId],
  );

  return ApiResponse.success({
    digestEmailEnabled: result.rows[0]?.digest_email_enabled ?? false,
  });
});
