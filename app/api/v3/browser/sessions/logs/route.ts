import { NextRequest } from "next/server";
import { BROWSERBASE_ENABLED } from "@/lib/config/constants";
import {
  BrowserBaseError,
  getBrowserSessionLogs,
  parseNetworkRequests,
} from "@/lib/browserbase/client";
import { getLiveNetworkRequests } from "@/lib/browserbase/network-capture";
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
  if (
    ownerRow &&
    ownerRow.rows.length > 0 &&
    ownerRow.rows[0].user_id !== session.userId
  ) {
    return ApiResponse.forbidden();
  }

  // Live CDP capture is the primary source: Browserbase's REST /logs is a
  // post-session artifact and returns little/nothing mid-session. If the live
  // capture has nothing yet (e.g. CDP unavailable, or a session that just ended
  // so its recording is now flushed), fall back to the post-session logs parse.
  const live = await getLiveNetworkRequests(id).catch(() => []);
  if (live.length > 0) {
    return ApiResponse.success({ requests: live });
  }

  try {
    const logs = await getBrowserSessionLogs(id);
    const requests = parseNetworkRequests(logs);
    return ApiResponse.success({ requests });
  } catch (err) {
    if (err instanceof BrowserBaseError) {
      // Live capture had nothing and the REST fallback errored (e.g. the
      // session is gone) -- surface that so the client knows why.
      return ApiResponse.error(err.message, err.status);
    }
    throw err;
  }
});
