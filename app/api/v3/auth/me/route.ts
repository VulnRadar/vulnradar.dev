import { type NextRequest } from "next/server";
import { withErrorHandling } from "@/lib/api/api-utils";
import { parseBearer } from "@/lib/api/bearer";
import { versioned } from "@/lib/api/v4/wrap";
import { meForApiKey, meForSession } from "@/lib/auth/me";

// Bearer token path: used by the browser extension and API clients. The
// session cookie path handles the web dashboard. The two halves live in
// lib/auth/me.ts so each can be mounted on its own when the routes move.
export const GET = versioned(
  "auth.me",
  withErrorHandling(async (request: NextRequest) =>
    parseBearer(request.headers.get("authorization")) !== null
      ? meForApiKey(request)
      : meForSession(),
  ),
);
