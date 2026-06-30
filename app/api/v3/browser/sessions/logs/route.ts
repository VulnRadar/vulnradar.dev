import { NextRequest } from "next/server";
import { BROWSERBASE_ENABLED } from "@/lib/config/constants";
import {
  BrowserBaseError,
  getBrowserSessionLogs,
  parseNetworkRequests,
} from "@/lib/browserbase/client";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { getSession } from "@/lib/auth";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!BROWSERBASE_ENABLED) {
    return ApiResponse.error("BrowserBase is not configured.", 503);
  }
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();

  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return ApiResponse.badRequest("Missing session id.");

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
