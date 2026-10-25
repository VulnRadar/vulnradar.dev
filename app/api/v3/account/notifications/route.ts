import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getNotificationPreferences } from "@/lib/notifications/notifications";
import { ALL_COLUMNS, ALWAYS_ON_COLUMNS } from "@/lib/notifications/columns";

// The columns and the always-on rule are the shared declarations in
// lib/notifications/columns.ts, the same ones the unsubscribe route and both
// preference screens read. The always-on rule was enforced by the unsubscribe
// route from the start and missed here, so the one-click endpoint refused to
// disable security alerts and the settings page next to it happily did, which
// silently suppressed the brute-force warning at app/api/v3/auth/login/route.ts.

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
  for (const col of ALL_COLUMNS) {
    if (col in data) {
      if (typeof data[col] !== "boolean") {
        return ApiResponse.badRequest(`Invalid value for ${col}`);
      }
      updates[col] = ALWAYS_ON_COLUMNS.has(col) ? true : data[col];
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
