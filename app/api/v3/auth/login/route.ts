import { NextRequest, NextResponse } from "next/server";
import { randomInt, randomBytes, createHash } from "node:crypto";
import {
  getUserByEmail,
  verifyPassword,
  createSession,
  hashPassword,
} from "@/lib/auth";
import pool from "@/lib/database/db";
import {
  checkRateLimit,
  peekRateLimit,
  resetRateLimit,
  getRateLimit,
  RATE_LIMITS,
} from "@/lib/rate-limiting/rate-limit";
import { getSetting } from "@/lib/config/runtime-config";
import {
  ApiResponse,
  Validate,
  parseBody,
  withErrorHandling,
} from "@/lib/api/api-utils";
import {
  getClientIp,
  getUserAgent,
  rateLimitIpKey,
} from "@/lib/api/request-utils";
import { signPendingToken } from "@/lib/auth/pending-2fa";
import {
  AUTH_2FA_PENDING_COOKIE,
  DEVICE_TRUST_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import {
  email2FACodeEmail,
  sendEmail,
  newLoginEmail,
  failedLoginAttemptsEmail,
} from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { findTrustedDevice } from "@/lib/auth/device-trust";

// auth: module-scoped cache for the dummy scrypt hash used to equalize
// timing between user-exists and user-doesn't-exist login paths.
let dummyHashCache: string | null = null;
async function getDummyHash(): Promise<string> {
  if (dummyHashCache) return dummyHashCache;
  const fixed =
    "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d";
  dummyHashCache = await hashPassword(fixed);
  return dummyHashCache;
}

/**
 * How much larger the per-ACCOUNT failed-login bucket is than the per-IP one.
 * Derived rather than a second registry key so an operator tuning the login
 * limit moves both together and the two can never drift into the state where
 * one IP's whole allowance is exactly enough to lock an account out.
 */
const ACCOUNT_LOCK_ATTEMPT_MULTIPLIER = 5;
const ACCOUNT_LOCK_WINDOW_MULTIPLIER = 4;

async function resolveAccountLockLimit(): Promise<{
  maxAttempts: number;
  windowSeconds: number;
}> {
  const { maxAttempts, windowSeconds } = await getRateLimit("login");
  return {
    maxAttempts: maxAttempts * ACCOUNT_LOCK_ATTEMPT_MULTIPLIER,
    windowSeconds: windowSeconds * ACCOUNT_LOCK_WINDOW_MULTIPLIER,
  };
}

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
  const rl = await checkRateLimit({
    key: `login:${rateLimitIpKey(ip)}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many login attempts. Try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  const user = await getUserByEmail(email);

  if (!user || !user.password_hash) {
    // No user, or an OAuth-only account with no password to check against
    // (see lib/auth/auth.ts's createOAuthUser). Both cases run the same
    // dummy check to equalize timing and return the same generic 401 --
    // revealing "this email exists but signs in with Google" would let an
    // attacker enumerate which provider owns a given address.
    await verifyPassword(password, await getDummyHash());
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // Per-account lockout gate. The failed-password branch below records
  // login-fail:${user.id} across IPs; once that counter is exhausted the
  // account is temporarily locked here, before the expensive scrypt verify,
  // so a distributed brute-force spread across many IPs is actually
  // throttled (the IP gate above alone would miss it) and stops burning CPU
  // on a locked account. The window auto-expires, so the backoff is
  // temporary. Read-only peek so this gate does not itself inflate the count.
  //
  // Deliberately NOT the same bucket size as the per-IP gate above. Sharing
  // it made the lock trivially weaponizable: one attacker IP is allowed
  // exactly `login` attempts per window, which was exactly enough to fill
  // the account bucket, so a single address could lock any known account out
  // continuously by firing its whole allowance at the top of each window,
  // and the victim was refused even with the correct password and a valid
  // 2FA code. The account cap is therefore a multiple of the per-IP cap over
  // a longer window: filling it now takes several source addresses, which is
  // what a genuine distributed attempt looks like.
  const accountLockLimit = await resolveAccountLockLimit();
  const accountLock = await peekRateLimit({
    key: `login-fail:${user.id}`,
    ...accountLockLimit,
  });
  if (!accountLock.allowed) {
    const minutes = Math.ceil(accountLock.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many failed attempts for this account. Try again in ${minutes} minute(s).`,
      accountLock.retryAfterSeconds,
    );
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    // Per-account brute-force detection. The gate at the top of this handler
    // is keyed by IP, so it stops a single address hammering the form but
    // misses a distributed attempt spread across many IPs at one account.
    // This second counter is keyed by the account and accumulates across
    // IPs; once it crosses the login threshold we email the owner, at most
    // once an hour (a separate one-shot key). Entirely best-effort: a
    // mail/DB failure here must never change the 401 the caller receives.
    try {
      const fail = await checkRateLimit({
        key: `login-fail:${user.id}`,
        ...accountLockLimit,
      });
      if (!fail.allowed) {
        const alertGate = await checkRateLimit({
          key: `login-fail-alert:${user.id}`,
          maxAttempts: 1,
          windowSeconds: 3600,
        });
        if (alertGate.allowed) {
          const { maxAttempts } = await getRateLimit("login");
          const userAgent = await getUserAgent();
          setImmediate(() => {
            sendNotificationEmail({
              userId: user.id,
              userEmail: user.email,
              type: "security",
              emailContent: failedLoginAttemptsEmail(maxAttempts, ip, {
                ipAddress: ip,
                userAgent,
              }),
            }).catch((err) =>
              console.error("Failed to send failed-login alert:", err),
            );
          });
        }
      }
    } catch (err) {
      console.error("Failed-login detection error:", err);
    }
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // The password was correct, so forgive the account's failure counter. The
  // counter exists to detect a brute-force in progress; leaving it standing
  // after the real owner has just proved they hold the password meant a
  // half-full bucket kept counting toward a lockout the owner could do
  // nothing about (there is no unlock-by-email path). The per-IP bucket is
  // deliberately NOT cleared: that one throttles the source address, not
  // the account, and clearing it would let one address reset its own quota
  // by interleaving a valid login.
  await resetRateLimit(`login-fail:${user.id}`);

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
    // auth: device-trust cookie is an opaque 256-bit random token stored
    // server-side in device_trust. A previous 32-bit hash of
    // `${ip}-${userAgent}` was brute-forceable for any attacker who
    // could read the IP/UA pair (e.g. via login-alert email leakage).
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
      // L-2: salted hash. Per-row 32-byte random salt + SHA-256 keeps
      // the verification table safe even if the DB leaks — a 6-digit
      // code has only 10^6 ≈ 20 bits of entropy, so an unsalted
      // pre-computed table is trivial to reverse.
      const codeSalt = randomBytes(32).toString("hex");
      const codeHash = createHash("sha256")
        .update(`${codeSalt}:${code}`)
        .digest("hex");
      const codeExpiryMinutes = await getSetting(
        "EMAIL_2FA_CODE_EXPIRY_MINUTES",
      );
      await pool.query(
        "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))",
        [user.id, codeHash, codeSalt, codeExpiryMinutes],
      );
      // Mask email for UI
      const parts = user.email.split("@");
      maskedEmail = parts[0].substring(0, 2) + "***@" + parts[1];
      // Send email in background - don't block the login response
      const emailContent = email2FACodeEmail(code);
      setImmediate(() => {
        sendEmail({
          to: user.email,
          ...emailContent,
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
    // Set a short-lived SIGNED cookie proving the password factor passed. The
    // verify route trusts the userId inside it, so it must not be forgeable
    // (a bare String(user.id) was -- see lib/auth/pending-2fa.ts).
    //
    // Resolved live, not from the compiled AUTH_2FA_PENDING_MAX_AGE constant:
    // the verify route, the email-code sender, and both OAuth callbacks all
    // already read getSetting("2FA_PENDING_MAX_AGE_SECONDS"), so this route
    // handing out a cookie with the shipped default made an admin who
    // lengthened the window get a cookie that expired before the token it
    // carries did, and one who shortened it get a cookie that outlived the
    // token check (AUDIT-009#settings-04).
    const pendingMaxAgeSeconds = await getSetting(
      "2FA_PENDING_MAX_AGE_SECONDS",
    );
    response.cookies.set(
      AUTH_2FA_PENDING_COOKIE,
      signPendingToken({ userId: user.id, ts: Date.now() }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: pendingMaxAgeSeconds, // seconds
      },
    );
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
