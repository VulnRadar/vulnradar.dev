import { NextRequest } from "next/server";
import { getSession, revokeOtherSessions } from "@/lib/auth";
import { reauthRefusal, verifyReauthPassword } from "@/lib/auth/reauth";
import {
  email2FAEnabledEmail,
  email2FADisabledEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { TOO_MANY_ATTEMPTS } from "@/lib/api/retry-in";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import {
  consumeEmailCode,
  issueEmailCode,
  maskEmail,
} from "@/lib/auth/email-codes";
import { signedInCodeEmail } from "@/lib/auth/step-up-email";

const EMAIL_NOT_CONFIGURED_MESSAGE =
  "This server cannot send email, so email codes cannot be turned on. Use an authenticator app instead.";

/**
 * Turning email codes on is two calls, both re-authenticated:
 *
 *   POST { password }        mails a confirmation code, changes nothing
 *   POST { password, code }  checks that code, then turns email codes on
 *
 * It used to flip totp_enabled on the first call, so an address that never
 * receives our mail (a typo, a dead mailbox, a server with no SMTP at all)
 * locked the account out at its next sign-in, and on a one-admin self-host
 * only direct database access got it back. The code proves the mail arrives
 * before the account depends on it. A server that cannot send mail is refused
 * outright, before any password is spent.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // Same reasoning as the authenticator setup beside it: this changes which
  // second factor guards the account.
  const refused = refuseWhileImpersonating(
    session,
    "Changing the account's two-factor method",
  );
  if (refused) return refused;

  if (!isEmailConfigured()) {
    return ApiResponse.conflict(EMAIL_NOT_CONFIGURED_MESSAGE);
  }

  // auth: rate-limit password verification so a stolen session cookie
  // cannot be used to brute-force the account password through this
  // endpoint. Same cap as login (5 attempts / 15 min).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `email-2fa-setup:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    return ApiResponse.tooManyRequests(
      TOO_MANY_ATTEMPTS("attempts", rl.retryAfterSeconds),
      rl.retryAfterSeconds,
    );
  }

  let body: { password?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return ApiResponse.badRequest("Invalid request body.");
  }
  if (!body || typeof body !== "object") {
    return ApiResponse.badRequest("Invalid request body.");
  }
  const { password, code } = body;

  // A password-less account confirms with the mailed step-up instead (see
  // verifyReauthPassword); its session alone is not enough.
  const reauth = await verifyReauthPassword(session.userId, password, {
    missing: "Password is required.",
    wrong: "Incorrect password.",
  });
  if (!reauth.ok) return reauthRefusal(reauth);

  const { rows } = await pool.query(
    "SELECT totp_enabled, two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  );
  if (rows.length === 0) return ApiResponse.notFound("User not found.");

  if (rows[0].totp_enabled && rows[0].two_factor_method === "app") {
    return ApiResponse.badRequest("Disable authenticator app 2FA first.");
  }

  if (code === undefined || code === null || code === "") {
    return sendConfirmationCode(session.userId, rows[0].email);
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return ApiResponse.badRequest("Enter the 6-digit code from the email.");
  }
  if (!(await consumeEmailCode(session.userId, "setup", code))) {
    return ApiResponse.badRequest(
      "That code did not match or has expired. Ask for a new one.",
    );
  }

  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
    [session.userId],
  );

  // Same reasoning as the authenticator-app path: enabling a second factor is
  // a privilege change, and it was the one privilege change that left the
  // sessions and trusted devices from before it standing.
  await revokeOtherSessions(session.userId);

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

async function sendConfirmationCode(userId: number, email: string) {
  const [cooldownSeconds, expiryMinutes] = await Promise.all([
    getSetting("EMAIL_2FA_RESEND_COOLDOWN_SECONDS"),
    getSetting("EMAIL_2FA_CODE_EXPIRY_MINUTES"),
  ]);
  const issued = await issueEmailCode(
    userId,
    "setup",
    expiryMinutes,
    cooldownSeconds,
  );
  if (!issued.ok) {
    return ApiResponse.tooManyRequests(
      "Please wait before requesting another code.",
      issued.retryAfterSeconds,
    );
  }
  await sendEmail({
    to: email,
    ...signedInCodeEmail("setup", issued.code, expiryMinutes),
  });
  return ApiResponse.success({
    codeSent: true,
    maskedEmail: maskEmail(email),
  });
}

// DELETE - Disable email 2FA
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // Same reasoning as the POST above: staff impersonating must not be able to
  // remove the customer's second factor.
  const refusedDisable = refuseWhileImpersonating(
    session,
    "Turning off two-factor authentication",
  );
  if (refusedDisable) return refusedDisable;

  // auth: same rate-limit cap as the POST (shared bucket so attempts on
  // either endpoint count toward the same window).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `email-2fa-setup:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    return ApiResponse.tooManyRequests(
      TOO_MANY_ATTEMPTS("attempts", rl.retryAfterSeconds),
      rl.retryAfterSeconds,
    );
  }

  let body: { password?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return ApiResponse.badRequest("Invalid request body.");
  }
  const password = body?.password;

  // Same rule as the POST: a password-less account confirms with the mailed
  // step-up. Turning off a second factor is exactly what a stolen session
  // would do first.
  const reauth = await verifyReauthPassword(session.userId, password, {
    missing: "Password is required.",
    wrong: "Incorrect password.",
  });
  if (!reauth.ok) return reauthRefusal(reauth);

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
  // The codes email sign-in issued, and an inbox check still waiting. Not a
  // step-up (purpose 'reauth'): a password-less account confirming another
  // change in another tab would have its code cancelled under it, the bug the
  // sign-in paths had until they cleared their own purpose only.
  await pool.query(
    "DELETE FROM email_2fa_codes WHERE user_id = $1 AND purpose IN ('login', 'setup')",
    [session.userId],
  );
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
