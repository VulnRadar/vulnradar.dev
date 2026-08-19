import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSession,
  deleteAllSessions,
  listUserSessions,
  hashSessionId,
} from "@/lib/auth";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { summarizeUserAgent } from "@/lib/auth/user-agent-summary";
import pool from "@/lib/database/db";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { sessionRevokedEmail } from "@/lib/email/email";

/**
 * List the caller's own active sessions. Session-owner-only: always
 * scoped to `session.userId` (see listUserSessions()'s WHERE user_id = $1),
 * with no admin bypass -- staff already have their own view of any user's
 * sessions in app/api/v3/admin/route.ts (section=user-detail).
 *
 * Each session's real `id` (the literal bearer token stored in the
 * httpOnly cookie -- see createSession in lib/auth/auth.ts) is never sent
 * to the client. hashSessionId() gives the response an opaque identifier
 * that DELETE /api/v3/auth/sessions/[id] can resolve back to the real id
 * (still scoped to this same user), without ever exposing a value that
 * could be replayed as a session cookie.
 */
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session?.userId) {
    return ApiResponse.unauthorized();
  }

  const cookieStore = await cookies();
  const currentSessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  const sessions = await listUserSessions(session.userId);

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: hashSessionId(s.id),
      ipAddress: s.ip_address,
      device: summarizeUserAgent(s.user_agent),
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      isCurrent: s.id === currentSessionId,
    })),
  });
});

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

  // Notify the account owner that every session was signed out. Gated on the
  // session_alerts preference. IP/device and the address are read here, while
  // the request context is still live; the send itself is deferred and
  // best-effort so a mail failure never affects the sign-out that already
  // happened above.
  const [emailRes, ipAddress, userAgent] = await Promise.all([
    pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
      session.userId,
    ]),
    getClientIp(),
    getUserAgent(),
  ]);
  const userEmail = emailRes.rows[0]?.email;
  if (userEmail) {
    setImmediate(() => {
      sendNotificationEmail({
        userId: session.userId,
        userEmail,
        type: "session_alerts",
        emailContent: sessionRevokedEmail({ ipAddress, userAgent }),
      }).catch((err) =>
        console.error("Failed to send session revoked email:", err),
      );
    });
  }

  return NextResponse.json({
    success: true,
    message: "All sessions revoked",
  });
});
