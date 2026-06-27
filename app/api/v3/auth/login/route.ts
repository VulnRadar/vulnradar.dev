import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getUserByEmail, verifyPassword, createSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  ApiResponse,
  Validate,
  parseBody,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import {
  AUTH_2FA_PENDING_COOKIE,
  AUTH_2FA_PENDING_MAX_AGE,
  DEVICE_TRUST_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { email2FACodeEmail, sendEmail, newLoginEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { findTrustedDevice } from "@/lib/auth/device-trust";

export const POST = withErrorHandling(async (request: Request) => {
  // Parse body
  const parsed = await parseBody<{ email: string; password: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { email, password } = parsed.data;

  // Validate input
  const error = Validate.multiple([
    Validate.required(email, "Email"),
    Validate.email(email),
    Validate.required(password, "Password"),
  ]);
  if (error) return ApiResponse.badRequest(error);

  // Rate limit by IP
  const ip = await getClientIp();
  const rl = await checkRateLimit({ key: `login:${ip}`, ...RATE_LIMITS.login });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many login attempts. Try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // Check if account is disabled or email not verified
  const userInfoResult = await pool.query(
    "SELECT totp_enabled, two_factor_method, disabled_at, email_verified_at FROM users WHERE id = $1",
    [user.id],
  );
  const userInfo = userInfoResult.rows[0];
  if (userInfo?.disabled_at) {
    return ApiResponse.forbidden(
      "This account has been suspended. Please contact support.",
    );
  }

  // Check if email is verified
  if (!userInfo?.email_verified_at) {
    return ApiResponse.forbidden(
      "Please verify your email before logging in.",
      {
        unverified: true,
      },
    );
  }

  // Check if 2FA is enabled
  const has2FA = userInfo?.totp_enabled === true;
  const twoFactorMethod = userInfo?.two_factor_method || "app";

  if (has2FA) {
    // H-3: device-trust cookie is now an opaque 32-byte random token
    // (256 bits) stored server-side in device_trust. The previous
    // implementation used a 32-bit hash of `${ip}-${userAgent}` which
    // is brute-forceable for any attacker who can read the IP/UA
    // pair (e.g. via login-alert email leakage).
    const userAgent = await getUserAgent();
    const deviceCookie = (request as unknown as NextRequest).cookies?.get?.(
      DEVICE_TRUST_COOKIE_NAME,
    )?.value;

    if (deviceCookie && (await findTrustedDevice(user.id, deviceCookie))) {
      // Device is trusted - create session directly without 2FA
      await createSession(user.id, ip, userAgent);

      // Send new login alert email in background
      setImmediate(() => {
        sendNotificationEmail({
          userId: user.id,
          userEmail: user.email,
          type: "login_alerts",
          emailContent: newLoginEmail("Trusted device", ip, {
            ipAddress: ip,
            userAgent,
          }),
        }).catch((err) => console.error("Failed to send login alert:", err));
      });

      return ApiResponse.success({
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    // If email 2FA, generate code and queue the email send (non-blocking)
    let maskedEmail: string | undefined;
    if (twoFactorMethod === "email") {
      // Delete old codes
      await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [
        user.id,
      ]);
      // Generate 6-digit code
      const code = randomInt(100000, 999999).toString();
      // Store hashed code with 10 min expiry
      await pool.query(
        "INSERT INTO email_2fa_codes (user_id, code_hash, expires_at) VALUES ($1, encode(sha256($2::bytea), 'hex'), NOW() + INTERVAL '10 minutes')",
        [user.id, code],
      );
      // Mask email for UI
      const parts = user.email.split("@");
      maskedEmail = parts[0].substring(0, 2) + "***@" + parts[1];
      // Send email in background - don't block the login response
      const emailContent = email2FACodeEmail(code);
      setImmediate(() => {
        sendEmail({
          to: user.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        }).catch((err) => console.error("Failed to send 2FA email code:", err));
      });
    }

    // Device is not trusted - require 2FA
    const response = NextResponse.json({
      requires2FA: true,
      userId: user.id,
      twoFactorMethod: twoFactorMethod,
      maskedEmail,
    });
    // Set a short-lived cookie to validate the 2FA verification request
    response.cookies.set(AUTH_2FA_PENDING_COOKIE, String(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_2FA_PENDING_MAX_AGE, // seconds
    });
    return response;
  }

  // No 2FA: create session directly
  const ua = await getUserAgent();
  await createSession(user.id, ip, ua);

  // Send new login alert email in background
  setImmediate(() => {
    sendNotificationEmail({
      userId: user.id,
      userEmail: user.email,
      type: "login_alerts",
      emailContent: newLoginEmail("New session", ip, {
        ipAddress: ip,
        userAgent: ua,
      }),
    }).catch((err) => console.error("Failed to send login alert:", err));
  });

  return ApiResponse.success({
    user: { id: user.id, email: user.email, name: user.name },
  });
});
