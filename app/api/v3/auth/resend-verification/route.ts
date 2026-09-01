import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { sendEmailVerification } from "@/lib/auth/email-verification";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `resend-verify:${rateLimitIpKey(ip)}`,
    ...RATE_LIMITS.forgotPassword,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many requests. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ email: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { email } = parsed.data;

  const emailError = Validate.email(email);
  if (emailError) return ApiResponse.badRequest(emailError);

  const normalizedEmail = email.toLowerCase().trim();

  // Find user (case-insensitive)
  const userRes = await pool.query(
    "SELECT id, name, email_verified_at FROM users WHERE LOWER(email) = $1",
    [normalizedEmail],
  );

  // Don't reveal if user exists or not
  if (userRes.rows.length === 0) {
    return ApiResponse.success({
      message:
        "If an account exists with this email, a verification link has been sent.",
    });
  }

  const user = userRes.rows[0];

  // Check if already verified
  if (user.email_verified_at) {
    return ApiResponse.success({
      message:
        "If an account exists with this email, a verification link has been sent.",
    });
  }

  // Mint + send a fresh verification link (stores hashAuthToken(token),
  // clears any prior tokens first). Shared with the profile email-change path.
  await sendEmailVerification(user.id, user.name, normalizedEmail);

  return ApiResponse.success({
    message:
      "If an account exists with this email, a verification link has been sent.",
  });
});
