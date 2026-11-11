import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse } from "@/lib/api/api-utils";
import { verifyPassword } from "@/lib/auth/password-hash";
import { domainToken } from "@/lib/auth/domain-token";
import { hashSessionId } from "@/lib/auth/auth";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";
import { isEmailConfigured } from "@/lib/email/email";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import {
  STEP_UP_MAX_AGE_SECONDS,
  STEP_UP_WINDOW,
} from "@/lib/auth/step-up-window";

export { STEP_UP_MAX_AGE_SECONDS };

export type ReauthResult =
  { ok: true } | { ok: false; status: 400 | 403; error: string; stepUp?: true };

/**
 * The step-up cookie a password-less account earns by entering a code mailed
 * to its address (POST /auth/2fa/email-send and /auth/2fa/verify with
 * `purpose: "reauth"`). httpOnly, so page script never sees it.
 */
export const STEP_UP_COOKIE = "vulnradar_step_up";

export const STEP_UP_CODE_MESSAGE =
  "Confirm it is you with a code from your email first.";
export const STEP_UP_SIGN_IN_MESSAGE = `Sign in again to confirm it is you, then try this within ${STEP_UP_WINDOW}.`;

// Same key as the pending-2FA cookie, its own domain string, so neither token
// can be replayed as the other.
const stepUpToken = domainToken(
  "vulnradar.reauth-step-up.v1",
  "re-authentication step-up tokens",
);

interface StepUpPayload {
  userId: number;
  bind: string;
  ts: number;
}

/**
 * What ties a step-up to one session. A digest of sessions.id rather than the
 * id itself: the id is what every ownership check keys on, and the cookie
 * payload is signed, not encrypted.
 */
function sessionBinding(sessionId: string): string {
  return createHash("sha256")
    .update(`vulnradar.step-up-bind:${sessionId}`)
    .digest("hex");
}

/** Mint the step-up cookie value for this user on this session. */
export function signStepUpToken(
  userId: number,
  sessionId: string,
  now: number = Date.now(),
): string {
  const payload: StepUpPayload = {
    userId,
    bind: sessionBinding(sessionId),
    ts: now,
  };
  return stepUpToken.sign(payload);
}

function stepUpHolds(
  token: string | undefined,
  userId: number,
  sessionId: string,
): boolean {
  const payload = stepUpToken.verify<StepUpPayload>(token);
  if (!payload || payload.userId !== userId) return false;
  if (payload.bind !== sessionBinding(sessionId)) return false;
  if (typeof payload.ts !== "number") return false;
  const age = Date.now() - payload.ts;
  return age >= 0 && age <= STEP_UP_MAX_AGE_SECONDS * 1000;
}

/** sessions.id of the session this request carries, or null. */
export async function currentSessionId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(AUTH_SESSION_COOKIE_NAME)?.value;
  return token ? hashSessionId(token) : null;
}

export function stepUpCookieOptions() {
  return {
    httpOnly: true,
    secure: cookiesRequireHttps(),
    sameSite: "strict" as const,
    path: "/",
    maxAge: STEP_UP_MAX_AGE_SECONDS,
  };
}

/**
 * A session created in the last ten minutes by a sign-in. Never an
 * impersonation session: staff opening one is not the owner signing in, and
 * the step-up cookie it could otherwise stand in for is refused to them too.
 */
async function sessionIsFresh(
  sessionId: string,
  userId: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 AS fresh FROM sessions
      WHERE id = $1 AND user_id = $2
        AND impersonated_by IS NULL
        AND created_at > NOW() - ($3 * INTERVAL '1 second')`,
    [sessionId, userId, STEP_UP_MAX_AGE_SECONDS],
  );
  return rows.length > 0;
}

/**
 * "Prove it is you" for a sensitive account action.
 *
 * A password account re-enters its password, as before. An account created
 * through Google, GitHub or Discord has `users.password_hash = NULL`, and this
 * used to let it through on the session alone, so a stolen session cookie
 * could change the email, set a password and switch 2FA off: a full and
 * persistent takeover. It now needs a step-up instead: a code mailed to the
 * account's address and entered back, which sets STEP_UP_COOKIE for this user
 * and this session for ten minutes. When the server cannot send mail the
 * step-up is a session created in the last ten minutes, which only a fresh
 * provider sign-in produces.
 *
 * Read here rather than passed in, so every caller (2FA setup, backup codes,
 * turning 2FA off, email codes, profile update, provider linking, the admin
 * actions) gets it without its request body changing. A password account
 * ignores the step-up cookie entirely: it is no substitute for the password.
 *
 * Fails closed on a missing users row (a stale session pointing at a deleted
 * account) with the same message a wrong password gets.
 */
export async function verifyReauthPassword(
  userId: number,
  suppliedPassword: unknown,
  messages: { missing: string; wrong: string },
): Promise<ReauthResult> {
  const row = await pool.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId],
  );
  if (row.rows.length === 0) {
    return { ok: false, status: 403, error: messages.wrong };
  }
  const storedHash = row.rows[0].password_hash;
  if (!storedHash) return verifyStepUp(userId);

  if (typeof suppliedPassword !== "string" || suppliedPassword.length === 0) {
    return { ok: false, status: 400, error: messages.missing };
  }
  if (!(await verifyPassword(suppliedPassword, storedHash))) {
    return { ok: false, status: 403, error: messages.wrong };
  }
  return { ok: true };
}

/**
 * The response for a failed re-auth. A missing step-up is always a 403 with
 * `stepUp: true`, so a client can offer the mailed code. A wrong password is
 * `wrongStatus` and a missing one `missingStatus`, because the routes this
 * replaced each had their own pair and v3 keeps them: some answer a wrong
 * password with a 401, the admin routes answer both with a 403, and account
 * deletion answers both with a 400.
 */
export function reauthRefusal(
  reauth: Extract<ReauthResult, { ok: false }>,
  wrongStatus: 400 | 401 | 403 = 403,
  missingStatus: 400 | 403 = 400,
): NextResponse {
  if (reauth.stepUp) {
    return ApiResponse.forbidden(reauth.error, { stepUp: true });
  }
  return ApiResponse.error(
    reauth.error,
    reauth.status === 400 ? missingStatus : wrongStatus,
  );
}

async function verifyStepUp(userId: number): Promise<ReauthResult> {
  const store = await cookies();
  const sessionId = await currentSessionId();
  if (
    sessionId &&
    stepUpHolds(store.get(STEP_UP_COOKIE)?.value, userId, sessionId)
  ) {
    return { ok: true };
  }
  if (!isEmailConfigured()) {
    if (sessionId && (await sessionIsFresh(sessionId, userId))) {
      return { ok: true };
    }
    return {
      ok: false,
      status: 403,
      error: STEP_UP_SIGN_IN_MESSAGE,
      stepUp: true,
    };
  }
  return { ok: false, status: 403, error: STEP_UP_CODE_MESSAGE, stepUp: true };
}
