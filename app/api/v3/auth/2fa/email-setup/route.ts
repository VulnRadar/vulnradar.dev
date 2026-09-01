import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import { email2FAEnabledEmail, email2FADisabledEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

// POST - Enable email 2FA
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // auth: rate-limit password verification so a stolen session cookie
  // cannot be used to brute-force the account password through this
  // endpoint. Same cap as login (5 attempts / 15 min).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `email-2fa-setup:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many attempts. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return ApiResponse.badRequest("Invalid request body.");
  }
  const { password } = body;

  // An OAuth-only account has no password to re-enter, so its session is the
  // re-auth signal instead (see verifyReauthPassword). Demanding one
  // unconditionally meant a Google/GitHub/Discord account could never turn on
  // email 2FA, which is the only second factor those accounts can use.
  const reauth = await verifyReauthPassword(session.userId, password, {
    missing: "Password is required.",
    wrong: "Incorrect password.",
  });
  if (!reauth.ok) {
    return reauth.status === 400
      ? ApiResponse.badRequest(reauth.error)
      : ApiResponse.forbidden(reauth.error);
  }

  const { rows } = await pool.query(
    "SELECT totp_enabled, two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  );
  if (rows.length === 0) return ApiResponse.notFound("User not found.");

  if (rows[0].totp_enabled && rows[0].two_factor_method === "app") {
    return ApiResponse.badRequest("Disable authenticator app 2FA first.");
  }

  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
    [session.userId],
  );

  // Non-blocking notification email
  const ua = await getUserAgent();
  const emailContent = email2FAEnabledEmail({
    ipAddress: ip || "Unknown",
    userAgent: ua || "Unknown",
  });
  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: rows[0].email,
      type: "two_factor_changes",
      emailContent,
    }).catch((err) =>
      console.error("Failed to send email 2FA enabled notification:", err),
    );
  });

  return ApiResponse.success({ success: true });
});

// DELETE - Disable email 2FA
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // auth: same rate-limit cap as the POST (shared bucket so attempts on
  // either endpoint count toward the same window).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `email-2fa-setup:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many attempts. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return ApiResponse.badRequest("Invalid request body.");
  }
  const { password } = body;

  // Same OAuth-only rule as the POST: without this, an account that has no
  // password could enable email 2FA and then never turn it off again.
  const reauth = await verifyReauthPassword(session.userId, password, {
    missing: "Password is required.",
    wrong: "Incorrect password.",
  });
  if (!reauth.ok) {
    return reauth.status === 400
      ? ApiResponse.badRequest(reauth.error)
      : ApiResponse.forbidden(reauth.error);
  }

  const { rows } = await pool.query(
    "SELECT two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  );
  if (rows.length === 0) return ApiResponse.notFound("User not found.");

  if (rows[0].two_factor_method !== "email") {
    return ApiResponse.badRequest("Email 2FA is not enabled.");
  }

  await pool.query(
    "UPDATE users SET totp_enabled = false, two_factor_method = NULL WHERE id = $1",
    [session.userId],
  );
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [
    session.userId,
  ]);
  // Same reasoning as the authenticator-app disable route: a device_trust row
  // is a standing "skip the second factor here" grant, so leaving them behind
  // meant re-enabling 2FA later silently re-honoured every previously trusted
  // browser, including one an attacker had planted.
  await pool.query("DELETE FROM device_trust WHERE user_id = $1", [
    session.userId,
  ]);

  // Non-blocking notification email
  const ua = await getUserAgent();
  const emailContent = email2FADisabledEmail({
    ipAddress: ip || "Unknown",
    userAgent: ua || "Unknown",
  });
  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: rows[0].email,
      type: "two_factor_changes",
      emailContent,
    }).catch((err) =>
      console.error("Failed to send email 2FA disabled notification:", err),
    );
  });

  return ApiResponse.success({ success: true });
});
