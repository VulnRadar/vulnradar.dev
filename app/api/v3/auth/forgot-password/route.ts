import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { secretLinkAppUrl } from "@/lib/config/server-app-url";
import { sendEmail, passwordResetEmail } from "@/lib/email/email";
import { issuePasswordResetToken } from "@/lib/auth/password-reset-token";
import {
  ApiResponse,
  parseBody,
  withErrorHandling,
  Validate,
} from "@/lib/api/api-utils";

// auth: the token is minted by lib/auth/password-reset-token.ts, which stores
// only its keyed digest so a DB dump doesn't yield working reset tokens
// (AUDIT-002#secrets-03), and replaces the account's old token in one
// transaction serialised per account. The admin "send reset link" action
// mints through the same function.

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `forgot:${rateLimitIpKey(ip)}`,
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

  const emailError = Validate.emailForLookup(email);
  if (emailError) return ApiResponse.badRequest(emailError);

  const normalizedEmail = email.trim().toLowerCase();

  // rate-limit: per-email rate limit on top of the per-IP limit.
  // Stops a residential NAT or botnet from spamming password
  // resets for many distinct addresses from a single source.
  // Named (not inline numbers) so an operator responding to a reset flood can
  // tighten this bucket from the admin panel like every other limiter, rather
  // than being stuck with the compiled value (AUDIT-014#magic-08).
  const emailRl = await checkRateLimit({
    key: `forgot-email:${normalizedEmail}`,
    ...RATE_LIMITS.forgotPasswordEmail,
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

  // Replaces any token the account already has, so two requests at once
  // still leave one live link.
  const token = await issuePasswordResetToken(user.id);

  // Send reset email via SMTP in the background
  const resetLink = `${secretLinkAppUrl()}/reset-password?token=${token}`;
  const emailPayload = passwordResetEmail(resetLink);

  queueMicrotask(() => {
    sendEmail({ to: normalizedEmail, ...emailPayload }).catch((err) => {
      console.error("[Email Error] Password reset email failed:", err);
    });
  });

  return ApiResponse.success(successMsg);
});
