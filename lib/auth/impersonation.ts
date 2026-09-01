/**
 * Admin impersonation (AUDIT-010): lets an admin/super_admin briefly act
 * as a plain user's account for support/debugging, without ever knowing
 * or resetting that user's password.
 *
 * Security posture:
 * - Only a "user"-tier target can be impersonated (STAFF_ROLE_HIERARCHY ==
 *   0). An admin can never impersonate another staff/admin account this
 *   way -- that would be a lateral-movement path into a privileged
 *   account, not a support tool.
 * - The impersonation session is short-lived (1 hour) regardless of the
 *   deployment's normal SESSION_TIMEOUT_DAYS setting, capping how long a
 *   forgotten "stop" leaves an admin sitting in someone else's account.
 * - The admin's own session token is preserved in a second, separate httpOnly
 *   cookie (not destroyed) so stopImpersonation can restore it -- the main
 *   session cookie is overwritten to the target's session while
 *   impersonating, so without this there would be no way back except
 *   logging in again.
 * - Every session row this creates carries impersonated_by, so the audit
 *   trail (and stopImpersonation's own defense-in-depth check) can always
 *   tell an impersonation session apart from a real login.
 */
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/client-constants";
import { hashSessionId } from "@/lib/auth/auth";

const IMPERSONATION_SESSION_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const RETURN_SESSION_COOKIE = "imp_return_session";

function generateSessionId(): string {
  return randomBytes(32).toString("hex");
}

export type StartImpersonationResult =
  { ok: true; targetEmail: string } | { ok: false; error: string };

export async function startImpersonation(
  adminId: number,
  targetUserId: number,
  ip?: string,
  userAgent?: string,
): Promise<StartImpersonationResult> {
  if (targetUserId === adminId) {
    return { ok: false, error: "Cannot impersonate your own account." };
  }

  const targetRes = await pool.query<{
    email: string;
    role: string | null;
    disabled_at: string | null;
  }>("SELECT email, role, disabled_at FROM users WHERE id = $1", [
    targetUserId,
  ]);
  const target = targetRes.rows[0];
  if (!target) return { ok: false, error: "User not found." };
  if (target.disabled_at) {
    return { ok: false, error: "Cannot impersonate a disabled account." };
  }
  if ((STAFF_ROLE_HIERARCHY[target.role || "user"] ?? 0) > 0) {
    return { ok: false, error: "Cannot impersonate a staff or admin account." };
  }

  const cookieStore = await cookies();
  // Cookies hold the raw bearer token; sessions.id holds its sha256 digest
  // (see createSession in lib/auth/auth.ts, AUDIT-012#auth-07). Every lookup
  // and delete in this file therefore hashes the cookie value first, and
  // every cookie write stores the raw token.
  const currentSessionToken = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!currentSessionToken) {
    return { ok: false, error: "No active admin session." };
  }

  const currentRes = await pool.query<{ impersonated_by: number | null }>(
    "SELECT impersonated_by FROM sessions WHERE id = $1",
    [hashSessionId(currentSessionToken)],
  );
  if (currentRes.rows[0]?.impersonated_by) {
    return { ok: false, error: "Already impersonating -- stop first." };
  }

  const sessionToken = generateSessionId();
  const expiresAt = new Date(Date.now() + IMPERSONATION_SESSION_MAX_AGE_MS);
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent, impersonated_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      hashSessionId(sessionToken),
      targetUserId,
      expiresAt,
      ip || null,
      userAgent || null,
      adminId,
    ],
  );

  const maxAge = IMPERSONATION_SESSION_MAX_AGE_MS / 1000;
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
  cookieStore.set(AUTH_SESSION_COOKIE_NAME, sessionToken, cookieOpts);
  cookieStore.set(RETURN_SESSION_COOKIE, currentSessionToken, cookieOpts);

  return { ok: true, targetEmail: target.email };
}

export type StopImpersonationResult =
  { ok: true } | { ok: false; error: string };

export async function stopImpersonation(): Promise<StopImpersonationResult> {
  const cookieStore = await cookies();
  const currentSessionToken = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  const returnSessionToken = cookieStore.get(RETURN_SESSION_COOKIE)?.value;

  if (!currentSessionToken || !returnSessionToken) {
    cookieStore.delete(RETURN_SESSION_COOKIE);
    return { ok: false, error: "Not currently impersonating." };
  }

  // Defense in depth: confirm the session actually being replaced really is
  // an impersonation session before touching anything, so a stray/forged
  // return-session cookie can never be used to hijack an ordinary session.
  const currentRes = await pool.query<{ impersonated_by: number | null }>(
    "SELECT impersonated_by FROM sessions WHERE id = $1",
    [hashSessionId(currentSessionToken)],
  );
  if (!currentRes.rows[0]?.impersonated_by) {
    cookieStore.delete(RETURN_SESSION_COOKIE);
    return { ok: false, error: "Not currently impersonating." };
  }

  const returnRes = await pool.query<{
    expires_at: string;
    role: string | null;
  }>(
    `SELECT s.expires_at, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [hashSessionId(returnSessionToken)],
  );
  const returnSession = returnRes.rows[0];
  const returnStillValid =
    !!returnSession &&
    new Date(returnSession.expires_at) > new Date() &&
    (STAFF_ROLE_HIERARCHY[returnSession.role || "user"] ?? 0) > 0;

  // Always tear down the impersonation session -- it should never outlive
  // the "stop" action, whether or not the admin's original session is
  // still valid to restore.
  await pool.query("DELETE FROM sessions WHERE id = $1", [
    hashSessionId(currentSessionToken),
  ]);
  cookieStore.delete(RETURN_SESSION_COOKIE);

  if (!returnStillValid) {
    cookieStore.delete(AUTH_SESSION_COOKIE_NAME);
    return {
      ok: false,
      error: "Your admin session expired. Please log in again.",
    };
  }

  cookieStore.set(AUTH_SESSION_COOKIE_NAME, returnSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  return { ok: true };
}
