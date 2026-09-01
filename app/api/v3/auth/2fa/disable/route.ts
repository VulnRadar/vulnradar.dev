import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import { twoFactorDisabledEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // auth: rate-limit password verification so a stolen session cookie
  // cannot be used to brute-force the account password through this
  // endpoint. Same cap as login (5 attempts / 15 min).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `2fa-disable:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many attempts. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ password: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { password } = parsed.data;

  // Re-auth before turning 2FA off. An OAuth-only account has no password
  // to re-enter, so its session is the re-auth signal instead (see
  // verifyReauthPassword): demanding one unconditionally left those accounts
  // unable to disable 2FA at all once it was on.
  const reauth = await verifyReauthPassword(session.userId, password, {
    missing: "Current password is required.",
    wrong: "Incorrect password.",
  });
  if (!reauth.ok) {
    return reauth.status === 400
      ? ApiResponse.badRequest(reauth.error)
      : ApiResponse.unauthorized(reauth.error);
  }

  // Disable 2FA and clear backup codes
  await pool.query(
    "UPDATE users SET totp_enabled = false, two_factor_method = NULL, totp_secret = NULL, backup_codes = NULL WHERE id = $1",
    [session.userId],
  );

  // auth: drop the trusted devices too. A device_trust row is a standing
  // "skip the second factor on this browser" grant. Leaving them behind
  // meant turning 2FA off and later back on silently re-honoured every
  // device trusted before, including one an attacker had planted, so the
  // account that just re-enrolled in 2FA was not actually protected on the
  // machine that mattered. The same wipe already happens on a password
  // change and a password reset.
  await pool.query("DELETE FROM device_trust WHERE user_id = $1", [
    session.userId,
  ]);

  // Send 2FA change notification email (don't await)
  const userAgent = await getUserAgent();

  const emailContent = twoFactorDisabledEmail({ ipAddress: ip, userAgent });
  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "two_factor_changes",
    emailContent,
  }).catch((err) =>
    console.error(
      "[Email Error] Failed to send 2FA disabled notification:",
      err,
    ),
  );

  return ApiResponse.success({ message: SUCCESS_MESSAGES.TWO_FA_DISABLED });
});
