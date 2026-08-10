import { NextResponse, NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  getSession,
  findUserSessionByHash,
  deleteSessionById,
} from "@/lib/auth";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";

/**
 * Revoke exactly one of the caller's own sessions -- the single-session
 * counterpart to DELETE /api/v3/auth/sessions (sign out everywhere).
 *
 * `id` here is the hashSessionId() digest GET /api/v3/auth/sessions
 * returned, never the raw session id/bearer token. findUserSessionByHash
 * resolves it back to a real session id scoped to `session.userId`, so a
 * hash that doesn't belong to (or doesn't exist for) the caller resolves
 * to null and this returns 404 -- it can never touch another user's
 * session row. This is the exact IDOR boundary exercised by
 * tests/app/api/v3/auth/sessions/[id]/route.test.ts.
 *
 * Revoking the CURRENT session through this endpoint is rejected rather
 * than silently signing the caller out from under themselves: that flow
 * already exists (the "Sign out everywhere" button / DELETE
 * /api/v3/auth/sessions), which also clears the cookie. Doing it here too
 * would leave a stale cookie pointing at a deleted session row.
 */
export const DELETE = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await getSession();
    if (!session?.userId) {
      return ApiResponse.unauthorized();
    }

    const { id: hashedId } = await params;
    if (!hashedId) {
      return ApiResponse.badRequest("Session id is required");
    }

    const target = await findUserSessionByHash(session.userId, hashedId);
    if (!target) {
      return ApiResponse.notFound("Session not found");
    }

    const cookieStore = await cookies();
    const currentSessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
    if (target.id === currentSessionId) {
      return ApiResponse.badRequest(
        'This is your current session. Use "Sign out everywhere" to end it.',
      );
    }

    const revoked = await deleteSessionById(session.userId, target.id);
    if (!revoked) {
      return ApiResponse.notFound("Session not found");
    }

    return NextResponse.json({ success: true });
  },
);
