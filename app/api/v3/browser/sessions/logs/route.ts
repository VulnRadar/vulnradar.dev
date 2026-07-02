import { NextRequest } from "next/server";
import { BROWSERBASE_ENABLED } from "@/lib/config/constants";
import {
  BrowserBaseError,
  getBrowserSessionLogs,
  parseNetworkRequests,
} from "@/lib/browserbase/client";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!BROWSERBASE_ENABLED) {
    return ApiResponse.error("BrowserBase is not configured.", 503);
  }
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();

  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return ApiResponse.badRequest("Missing session id.");

  // Ownership check (AUDIT-004#idor-01).
  const ownerRow = await pool
    .query<{ user_id: number }>(
      "SELECT user_id FROM browser_sessions WHERE id = $1",
      [id],
    )
    .catch(() => null);
  if (ownerRow && ownerRow.rows.length > 0 && ownerRow.rows[0].user_id !== session.userId) {
    return ApiResponse.forbidden();
  }

  try {
    const logs = await getBrowserSessionLogs(id);
    const requests = parseNetworkRequests(logs);
    return ApiResponse.success({ requests });
  } catch (err) {
    if (err instanceof BrowserBaseError) {
      return ApiResponse.error(err.message, err.status);
    }
    throw err;
  }
});
