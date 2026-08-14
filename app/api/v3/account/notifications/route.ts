import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import {
  ALL_COLUMNS,
  getNotificationPreferences,
} from "@/lib/notifications/notifications";

// Derived from NOTIFICATION_COLUMNS (lib/notifications/notifications.ts),
// the single source of truth every notification column comes from -- this
// used to be its own manually-maintained list that had already drifted out
// of sync with NOTIFICATION_COLUMNS once (missing email_posture_digest).
const ALL_PREF_COLUMNS = ALL_COLUMNS;

// GET: Fetch notification preferences
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const prefs = await getNotificationPreferences(session.userId);
  return ApiResponse.success(prefs);
});

// PUT: Update notification preferences
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const parsed = await parseBody<Record<string, boolean>>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const data = parsed.data;

  // Validate: only accept known columns, all must be booleans
  const updates: Record<string, boolean> = {};
  for (const col of ALL_PREF_COLUMNS) {
    if (col in data) {
      if (typeof data[col] !== "boolean") {
        return ApiResponse.badRequest(`Invalid value for ${col}`);
      }
      updates[col] = data[col];
    }
  }

  if (Object.keys(updates).length === 0) {
    return ApiResponse.badRequest("No valid preferences provided.");
  }

  // Build dynamic upsert
  const cols = Object.keys(updates);
  const vals = Object.values(updates);
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const insertCols = ["user_id", ...cols].join(", ");
  const insertVals = cols.map((_, i) => `$${i + 2}`).join(", ");

  const result = await pool.query(
    `INSERT INTO notification_preferences (${insertCols}, updated_at)
     VALUES ($1, ${insertVals}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = NOW()
     RETURNING *`,
    [session.userId, ...vals],
  );

  return ApiResponse.success(result.rows[0], 200);
});
