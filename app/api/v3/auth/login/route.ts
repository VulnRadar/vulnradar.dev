import { NextRequest, NextResponse } from "next/server";
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
import { loginsPausedResponseFor } from "@/lib/admin/service-state";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";
import { upgradePasswordHash } from "@/lib/auth/auth";
import { TOO_MANY_ATTEMPTS } from "@/lib/api/retry-in";
import { logError } from "@/lib/logging/log";
import { maskEmail, storeEmailCode } from "@/lib/auth/email-codes";
import {
  loginLockAlertKey,
  loginLockKey,
  passesAccountLock,
  resolveAccountLockLimit,
} from "@/lib/auth/login-lock";

// The pending sign-ins the OAuth and Discord callbacks park while they wait
// for a second factor (app/api/v3/auth/oauth/[provider]/callback and
// app/api/v3/auth/discord/callback). Only one sign-in can be pending per
// browser: with two cookies, 2FA verify and email-send resolved different
// accounts, so the code went to one inbox and was checked against the other.
const OTHER_PENDING_LOGIN_COOKIES = [
  "oauth_pending_login",
  "discord_pending_login",
] as const;

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

export const POST = withErrorHandling(async (request: Request) => {
  // Parse body
  const parsed = await parseBody<{ email: string; password: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { email, password } = parsed.data;

  // Validate input
  const error = Validate.multiple([
    Validate.required(email, "Email"),
    Validate.emailForLookup(email),
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
    return ApiResponse.tooManyRequests(
      TOO_MANY_ATTEMPTS("login attempts", rl.retryAfterSeconds),
      rl.retryAfterSeconds,
    );
  }

  // Hashed, keyed on the submitted address (see lib/auth/login-lock.ts).
  const accountKey = loginLockKey(email);

  // Per-address lockout, read before the account is even looked up. The
  // failed-password bookkeeping below records login-fail:<hash> across IPs,
  // so a distributed brute force spread over many IPs is throttled (the IP
  // gate above alone misses it). The window expires on its own, and the peek
  // does not itself count.
  //
  // Every address goes through this gate and every failure below fills it,
  // whether or not an account exists or has a password. When only existing
  // password accounts were counted, a 429 here was proof the address was
  // registered, and the two IPs it takes to fill the bucket could lock out
  // only the accounts that really existed. The refusal text names no
  // account for the same reason.
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
  //
  // A full bucket is not a wall for the owner (ATK-8). Filling it takes a
  // few source addresses and can be redone every window, so refusing the
  // right password outright let anyone who knew an address keep its owner
  // out. A locked request is therefore looked up and verified exactly as an
  // unlocked one is, and passes only with the right password from a browser
  // this account already trusts (passesAccountLock); everything else gets
  // the same refusal it always did. That costs a scrypt verify per locked
  // attempt where the gate used to skip it, which the per-IP limit above
  // still bounds. The other way back in is a password reset, which empties
  // the bucket.
  const accountLockLimit = await resolveAccountLockLimit();
  const accountLock = await peekRateLimit({
    key: accountKey,
    ...accountLockLimit,
  });

  const user = await getUserByEmail(email);

  // No user, or an OAuth-only account with no password to check against
  // (see lib/auth/auth.ts's createOAuthUser), runs a dummy check to equalize
  // timing and gets the same generic 401 as a wrong password: revealing
  // "this email exists but signs in with Google" would let an attacker
  // enumerate which provider owns a given address.
  const passwordHash = user?.password_hash ?? null;
  let valid = false;
  if (passwordHash) valid = await verifyPassword(password, passwordHash);
  else await verifyPassword(password, await getDummyHash());

  if (!accountLock.allowed) {
    const passes = await passesAccountLock({
      userId: user?.id ?? null,
      passwordValid: !!user && !!passwordHash && valid,
      deviceCookie: (request as unknown as NextRequest).cookies?.get?.(
        DEVICE_TRUST_COOKIE_NAME,
      )?.value,
    });
    if (!passes) {
      return ApiResponse.tooManyRequests(
        TOO_MANY_ATTEMPTS(
          "failed sign-in attempts",
          accountLock.retryAfterSeconds,
        ),
        accountLock.retryAfterSeconds,
      );
    }
  }

  if (!user || !passwordHash || !valid) {
    // Per-address brute-force detection. The gate at the top of this handler
    // is keyed by IP, so it stops a single address hammering the form but
    // misses a distributed attempt spread across many IPs at one account.
    // This second counter is keyed by the address and accumulates across
    // IPs; once it crosses the login threshold we email the owner, if there
    // is one, at most once an hour (a separate one-shot key). Entirely
    // best-effort: a mail/DB failure here must never change the 401 the
    // caller receives.
    try {
      const fail = await checkRateLimit({
        key: accountKey,
        ...accountLockLimit,
      });
      if (!fail.allowed) {
        // The one-shot key is spent for unknown addresses too, so whether
        // anyone is mailed costs no extra round trip an attacker could time.
        const alertGate = await checkRateLimit({
          key: loginLockAlertKey(email),
          maxAttempts: 1,
          windowSeconds: 3600,
        });
        if (alertGate.allowed && user) {
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
              logError("auth", "failed-login alert email failed", err, {
                userId: user.id,
              }),
            );
          });
        }
      }
    } catch (err) {
      logError("auth", "failed-login detection failed", err, {
        userId: user?.id,
      });
    }
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS);
  }

  // The password is in hand only here, so this is where an old hash is
  // brought up to the current cost.
  await upgradePasswordHash(user.id, password, passwordHash);

  // The password was correct, so forgive the account's failure counter. The
  // counter exists to detect a brute-force in progress; leaving it standing
  // after the real owner has just proved they hold the password meant a
  // half-full bucket kept counting toward a lockout. That includes a full
  // bucket the owner just passed from a trusted device. The per-IP bucket is
  // deliberately NOT cleared: that one throttles the source address, not
  // the account, and clearing it would let one address reset its own quota
  // by interleaving a valid login.
  await resetRateLimit(accountKey);

  // Check if account is disabled or email not verified
  // `role` rides along for the PAUSE_LOGINS check below rather than costing a
  // second round trip.
  const userInfoResult = await pool.query(
    "SELECT totp_enabled, two_factor_method, disabled_at, email_verified_at, role FROM users WHERE id = $1",
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

  // PAUSE_LOGINS (and MAINTENANCE_MODE, which implies it). Staff are exempt,
  // which is the property that keeps this switch from locking out the person
  // who has to turn it off.
  //
  // Placed here, after the password has already been verified, rather than at
  // the top of the handler. Gating on the way in would answer "logins are
  // paused" for an unknown address and fall through to the normal flow for a
  // staff address, which turns the pause into a way to enumerate staff
  // accounts. Here, only someone who has already proved they own the account
  // learns anything at all.
  //
  // This refuses a NEW session. It does not revoke existing ones: see the
  // registry help for PAUSE_LOGINS.
  const loginsPaused = await loginsPausedResponseFor(userInfo?.role);
  if (loginsPaused) return loginsPaused;

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
        }).catch((err) =>
          logError("auth", "login alert email failed", err, {
            userId: user.id,
          }),
        );
      });

      return ApiResponse.success({
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    // If email 2FA, generate code and queue the email send (non-blocking)
    let maskedEmail: string | undefined;
    if (twoFactorMethod === "email") {
      // The one issuer (lib/auth/email-codes.ts): salted, stored for the
      // login purpose only, so a step-up or inbox-check code mailed to the
      // same account a moment ago survives a sign-in elsewhere.
      const codeExpiryMinutes = await getSetting(
        "EMAIL_2FA_CODE_EXPIRY_MINUTES",
      );
      const code = await storeEmailCode(user.id, "login", codeExpiryMinutes);
      maskedEmail = maskEmail(user.email);
      // Send email in background - don't block the login response
      const emailContent = email2FACodeEmail(code, codeExpiryMinutes);
      setImmediate(() => {
        sendEmail({
          to: user.email,
          ...emailContent,
        }).catch((err) =>
          logError("auth", "2FA code email failed", err, { userId: user.id }),
        );
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
        secure: cookiesRequireHttps(),
        sameSite: "lax",
        path: "/",
        maxAge: pendingMaxAgeSeconds, // seconds
      },
    );
    for (const name of OTHER_PENDING_LOGIN_COOKIES) {
      response.cookies.delete(name);
    }
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
    }).catch((err) =>
      logError("auth", "login alert email failed", err, { userId: user.id }),
    );
  });

  return ApiResponse.success({
    user: { id: user.id, email: user.email, name: user.name },
  });
});
