import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { secretLinkAppUrl } from "@/lib/config/server-app-url";
import { getSetting } from "@/lib/config/runtime-config";
import { sendEmail, passwordResetEmail } from "@/lib/email/email";
import { issueResetLinkToken } from "@/lib/auth/password-reset-token";
import {
  ApiResponse,
  parseBody,
  withErrorHandling,
  Validate,
} from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";

// The longest address SMTP can carry, and the rule isValidEmailAddress holds
// new addresses to. A longer string cannot name an account.
const MAX_EMAIL_LENGTH = 254;

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
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES("reset attempts", minutes),
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ email: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { email } = parsed.data;

  const emailError = Validate.emailForLookup(email);
  if (emailError) return ApiResponse.badRequest(emailError);

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail.length > MAX_EMAIL_LENGTH) {
    return ApiResponse.badRequest("Please enter a valid email address");
  }

  // rate-limit: per-email rate limit on top of the per-IP limit.
  // Stops a residential NAT or botnet from spamming password
  // resets for many distinct addresses from a single source.
  // Named (not inline numbers) so an operator responding to a reset flood can
  // tighten this bucket from the admin panel like every other limiter, rather
  // than being stuck with the compiled value (AUDIT-014#magic-08).
  //
  // Keyed on a digest of the address, as login's per-address bucket is. The
  // address itself overflowed rate_limits.key (VARCHAR(255)) from 243
  // characters on, which answered 500, and it kept a list of every address
  // anyone had asked to reset.
  const emailRl = await checkRateLimit({
    key: `forgot-email:${createHash("sha256").update(normalizedEmail).digest("hex")}`,
    ...RATE_LIMITS.forgotPasswordEmail,
  });
  if (!emailRl.allowed) {
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS_MINUTES(
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

  // Compared as getUserByEmail does (see the reason there). `email = $1` hid
  // an address saved with capitals before writers lowercased, so its owner
  // could sign in but never get a reset link.
  const userRes = await pool.query(
    `SELECT id, email, totp_enabled FROM users
     WHERE LOWER(email) = LOWER($1)
     ORDER BY (email = $1) DESC, id
     LIMIT 1`,
    [normalizedEmail],
  );
  if (userRes.rows.length === 0) {
    return ApiResponse.success(successMsg);
  }

  const user = userRes.rows[0];

  // Replaces any token the account already has, so two requests at once
  // still leave one live link.
  const token = await issueResetLinkToken(user.id);

  // Send reset email via SMTP in the background
  const resetLink = `${secretLinkAppUrl()}/reset-password?token=${token}`;
  const emailPayload = passwordResetEmail(
    resetLink,
    await getSetting("PASSWORD_RESET_HOURS"),
  );

  // To the row's address, not the typed one: the lookup no longer guarantees
  // they are the same string, and a reset link only ever goes to the address
  // the account holds.
  queueMicrotask(() => {
    sendEmail({ to: user.email, ...emailPayload }).catch((err) => {
      logError("auth", "password reset email failed", err, {
        userId: user.id,
      });
    });
  });

  return ApiResponse.success(successMsg);
});
