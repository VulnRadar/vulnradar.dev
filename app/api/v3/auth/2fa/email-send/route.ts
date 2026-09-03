import { NextRequest } from "next/server";
import { randomInt, randomBytes, createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { email2FACodeEmail, sendEmail } from "@/lib/email/email";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { AUTH_2FA_PENDING_COOKIE } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { verifyPendingToken } from "@/lib/auth/pending-2fa";

export const POST = withErrorHandling(async (request: NextRequest) => {
  // The user id comes ONLY from a cryptographically-signed pending cookie
  // (lib/auth/pending-2fa.ts) -- both the password-login and the OAuth/Discord
  // cookies. A forgeable pending cookie here would let anyone trigger a 2FA
  // email to any account (and pin the userId for the verify step).
  const pending = request.cookies.get(AUTH_2FA_PENDING_COOKIE)?.value;
  const discordPending = request.cookies.get("discord_pending_login")?.value;
  const oauthPending = request.cookies.get("oauth_pending_login")?.value;

  let userId: number | null = null;

  const parsed = verifyPendingToken<{ userId: number; ts: number }>(
    pending ?? discordPending ?? oauthPending,
  );
  if (parsed && typeof parsed.userId === "number") {
    const pendingMaxAgeMs =
      (await getSetting("2FA_PENDING_MAX_AGE_SECONDS")) * 1000;
    if (Date.now() - parsed.ts > pendingMaxAgeMs) {
      return ApiResponse.unauthorized(
        "Login session expired. Please sign in again.",
      );
    }
    userId = parsed.userId;
  }

  if (!userId) {
    return ApiResponse.unauthorized("No pending 2FA session.");
  }

  // Get user email
  const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [
    userId,
  ]);
  const user = userResult.rows[0];
  if (!user) return ApiResponse.badRequest("User not found.");

  // Check if a code was recently sent
  const resendCooldownSeconds = await getSetting(
    "EMAIL_2FA_RESEND_COOLDOWN_SECONDS",
  );
  const recentCode = await pool.query(
    "SELECT created_at FROM email_2fa_codes WHERE user_id = $1 AND created_at > NOW() - ($2 * INTERVAL '1 second') ORDER BY created_at DESC LIMIT 1",
    [userId, resendCooldownSeconds],
  );
  if (recentCode.rows.length > 0) {
    return ApiResponse.tooManyRequests(
      "Please wait before requesting another code.",
      resendCooldownSeconds,
    );
  }

  // Delete old codes for this user
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [userId]);

  // Generate 6-digit code
  const code = randomInt(100000, 999999).toString();

  // L-2: salted hash. Same shape as the login route's email 2FA.
  const codeSalt = randomBytes(32).toString("hex");
  const codeHash = createHash("sha256")
    .update(`${codeSalt}:${code}`)
    .digest("hex");
  const codeExpiryMinutes = await getSetting("EMAIL_2FA_CODE_EXPIRY_MINUTES");
  await pool.query(
    "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))",
    [userId, codeHash, codeSalt, codeExpiryMinutes],
  );

  // Send the email
  const emailContent = email2FACodeEmail(code);
  await sendEmail({
    to: user.email,
    ...emailContent,
  });

  // Mask email for UI
  const parts = user.email.split("@");
  const masked = parts[0].substring(0, 2) + "***@" + parts[1];

  return ApiResponse.success({ message: "Code sent.", maskedEmail: masked });
});
