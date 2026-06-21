import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, deleteAllSessions } from "@/lib/auth";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";

export const DELETE = withErrorHandling(async () => {
  const session = await getSession();
  if (!session?.userId) {
    return ApiResponse.unauthorized();
  }

  // Delete all sessions for this user (including current one)
  await deleteAllSessions(session.userId);

  // clear the actual session cookie. The
  // previous code used the literal "session" name, which doesn't match
  // the cookie set by `createSession` (default `vulnradar_session`).
  // Use the cookie store directly to clear the correct cookie with
  // the same options used at creation.
  const cookieStore = await cookies();
  cookieStore.set(AUTH_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return NextResponse.json({
    success: true,
    message: "All sessions revoked",
  });
});
