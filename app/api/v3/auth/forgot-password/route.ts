import { NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp } from "@/lib/api/request-utils";
import {
  PASSWORD_RESET_TOKEN_LIFETIME,
  ERROR_MESSAGES,
  APP_URL,
} from "@/lib/config/constants";
import { sendEmail, passwordResetEmail } from "@/lib/email/email";
import {
  ApiResponse,
  parseBody,
  withErrorHandling,
  Validate,
} from "@/lib/api/api-utils";

// auth: hash the token before storage so a DB dump doesn't yield
// working reset tokens. The verify route hashes the incoming
// token with the same function before lookup.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `forgot:${ip}`,
    ...RATE_LIMITS.forgotPassword,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS("reset attempts", minutes),
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ email: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { email } = parsed.data;

  const emailError = Validate.email(email);
  if (emailError) return ApiResponse.badRequest(emailError);

  const normalizedEmail = email.trim().toLowerCase();

  // rate-limit: per-email rate limit on top of the per-IP limit.
  // Stops a residential NAT or botnet from spamming password
  // resets for many distinct addresses from a single source.
  const emailRl = await checkRateLimit({
    key: `forgot-email:${normalizedEmail}`,
    maxAttempts: 3,
    windowSeconds: 60 * 60,
  });
  if (!emailRl.allowed) {
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS(
        "reset attempts for this email",
        Math.ceil(emailRl.retryAfterSeconds / 60),
      ),
      emailRl.retryAfterSeconds,
    );
  }

  // Always return success to prevent email enumeration
  const successMsg = {
    message:
      "If an account with that email exists, a reset link has been generated.",
  };

  const userRes = await pool.query(
    "SELECT id, totp_enabled FROM users WHERE email = $1",
    [normalizedEmail],
  );
  if (userRes.rows.length === 0) {
    return ApiResponse.success(successMsg);
  }

  const user = userRes.rows[0];

  // Delete any existing tokens for this user
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
    user.id,
  ]);

  // Generate a secure token (raw token is emailed; we store the hash)
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_LIFETIME * 1000);

  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.id, tokenHash, expiresAt],
  );

  // Send reset email via SMTP in the background
  const resetLink = `${APP_URL}/reset-password?token=${token}`;
  const emailPayload = passwordResetEmail(resetLink);

  queueMicrotask(() => {
    sendEmail({ to: normalizedEmail, ...emailPayload }).catch((err) => {
      console.error("[Email Error] Password reset email failed:", err);
    });
  });

  return ApiResponse.success(successMsg);
});
