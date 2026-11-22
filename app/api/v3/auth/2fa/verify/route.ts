import { NextRequest, NextResponse } from "next/server";
import { createSession, getSession, verifyPassword } from "@/lib/auth";
import { decryptApiKey } from "@/lib/auth/crypto";
import { verifyTOTPWithCounter } from "@/lib/auth/totp";
import pool from "@/lib/database/db";
import { consumeTotpStep } from "@/lib/auth/totp-step";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { newLoginEmail } from "@/lib/email/email";
import {
  ApiResponse,
  readJsonObject,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { TOO_MANY_ATTEMPTS } from "@/lib/api/retry-in";
import {
  DISCORD_PENDING_COOKIE,
  OAUTH_PENDING_COOKIE,
  PENDING_COOKIE_NAMES,
  resolvePendingUser,
} from "@/lib/auth/pending-user";
import { consumeEmailCode } from "@/lib/auth/email-codes";
import {
  currentSessionId,
  signStepUpToken,
  STEP_UP_COOKIE,
  stepUpCookieOptions,
} from "@/lib/auth/reauth";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import {
  DEVICE_TRUST_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { upsertTrustedDevice } from "@/lib/auth/device-trust";
import { loginsPausedResponseFor } from "@/lib/admin/service-state";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";

const SIX_DIGITS = /^\d{6}$/;

/**
 * Two buckets: one keyed by (user, ip) and one by user alone, so a caller who
 * already holds the first factor (or a session, for the step-up) cannot
 * brute-force the 6-digit code by rotating source IPs. Admin-configurable,
 * default 5 per 5 minutes (RATE_LIMIT_2FA_VERIFY_*). The step-up shares the
 * user bucket with sign-in, so mixing the two buys no extra guesses.
 */
async function twoFactorAttemptLimit(
  userId: number,
  ip: string,
  scope: "2fa-verify" | "2fa-step-up" = "2fa-verify",
): Promise<NextResponse | null> {
  for (const key of [`${scope}:${userId}:${ip}`, `2fa-verify-user:${userId}`]) {
    const rl = await checkRateLimit({ key, ...RATE_LIMITS.twoFactorVerify });
    if (!rl.allowed) {
      return ApiResponse.tooManyRequests(
        TOO_MANY_ATTEMPTS("2FA attempts", rl.retryAfterSeconds),
        rl.retryAfterSeconds,
      );
    }
  }
  return null;
}

/** users.backup_codes is a JSON array of hashes in a TEXT column. */
function parseBackupCodes(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((h): h is string => typeof h === "string")
      : [];
  } catch {
    return [];
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const userAgent = await getUserAgent();

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.purpose === "reauth") {
    return verifyStepUp(parsed.data.code, ip);
  }
  // `userId` from the body is intentionally NOT destructured: it must never be
  // trusted for authorization. The effective user id comes only from a signed
  // pending cookie below (lib/auth/pending-2fa.ts).
  const { code, backupCode, rememberDevice } = parsed.data;
  // Both codes are read as text further down (.trim on the backup code), so a
  // number or an array there was a TypeError and a 500.
  if (
    (code !== undefined && code !== null && typeof code !== "string") ||
    (backupCode !== undefined &&
      backupCode !== null &&
      typeof backupCode !== "string")
  ) {
    return ApiResponse.badRequest("Code and backup code must be text.");
  }

  const validationError = Validate.multiple([
    Validate.required(code || backupCode, "Code or backup code"),
  ]);
  if (validationError) return ApiResponse.badRequest(validationError);

  // Whose sign-in this is. Three possible sources: a password login
  // (AUTH_2FA_PENDING_COOKIE), a Discord sign-in (discord_pending_login), or a
  // Google/GitHub/Discord OAuth sign-in (oauth_pending_login). The user id is
  // ONLY ever taken from one of those signed cookies, never from the request
  // body: the body's userId used to be trusted after a compare against a
  // forgeable cookie, which let anyone reach a victim's 2FA step without their
  // password. email-send asks the same resolver, so the code it mailed and the
  // code checked here are always for the same account.
  const pending = await resolvePendingUser(request);
  if (!pending.ok) {
    if (pending.reason === "expired") {
      return ApiResponse.unauthorized(
        pending.cookieName === DISCORD_PENDING_COOKIE
          ? "Discord login session expired. Please try again."
          : pending.cookieName === OAUTH_PENDING_COOKIE
            ? "That sign-in session expired. Please try again."
            : ERROR_MESSAGES.INVALID_2FA_SESSION,
      );
    }
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION);
  }
  const effectiveUserId = pending.userId;

  // auth: rate-limit 2FA attempts (admin-configurable, default 5 / 5 min --
  // RATE_LIMIT_2FA_VERIFY_ATTEMPTS/WINDOW_MINUTES). Two buckets: one keyed by
  // (user, ip) and one keyed by user alone, so an attacker who already holds
  // the password (and thus a valid signed pending cookie) can't brute-force the
  // 6-digit code by rotating source IPs to reset the per-ip bucket.
  const limited = await twoFactorAttemptLimit(effectiveUserId, ip);
  if (limited) return limited;

  // Get user's TOTP secret, backup codes, and 2FA method. `role` rides along
  // for the PAUSE_LOGINS check further down.
  const result = await pool.query(
    "SELECT totp_secret, totp_enabled, backup_codes, two_factor_method, role FROM users WHERE id = $1",
    [effectiveUserId],
  );
  const user = result.rows[0];
  if (!user || !user.totp_enabled) {
    return ApiResponse.badRequest("2FA is not enabled for this account.");
  }

  const method = user.two_factor_method || "app";
  let verified = false;

  if (backupCode && method === "app") {
    // Verify backup code against hashed codes (only for app-based 2FA).
    //
    // Each comparison is a 128 MiB scrypt, up to eight of them, two at a time
    // under lib/auth/password-hash's limiter: seconds of work. Doing it inside
    // the transaction below held a pooled connection and a FOR UPDATE lock on
    // the users row for all of it, stalling every writer of that row. So the
    // hashes come from the plain read above, the comparisons run first, and
    // the lock is taken only to confirm the matched hash is still there and
    // remove it.
    const normalizedInput = backupCode
      .trim()
      .toUpperCase()
      .replace(/[\s-]/g, "");
    const storedHashes = parseBackupCodes(user.backup_codes);
    // Compare against every stored code before picking a match. Checking
    // them all keeps the response time independent of which slot matched,
    // so the timing does not reveal a code's position.
    const comparisons = await Promise.all(
      storedHashes.map(async (hash: string) => {
        try {
          return await verifyPassword(normalizedInput, hash);
        } catch {
          return false;
        }
      }),
    );
    const matchIndex = comparisons.indexOf(true);
    if (matchIndex >= 0) {
      const matchedHash = storedHashes[matchIndex];
      // Two requests with the same code can both get this far, because the
      // comparisons above hold no lock. The re-read under FOR UPDATE is what
      // keeps a code single-use: the second one finds its hash already gone.
      const lockClient = await pool.connect();
      try {
        await lockClient.query("BEGIN");
        const lockResult = await lockClient.query(
          "SELECT backup_codes FROM users WHERE id = $1 FOR UPDATE",
          [effectiveUserId],
        );
        const current = parseBackupCodes(lockResult.rows[0]?.backup_codes);
        const stillThere = current.indexOf(matchedHash);
        if (stillThere < 0) {
          await lockClient.query("ROLLBACK");
        } else {
          current.splice(stillThere, 1);
          await lockClient.query(
            "UPDATE users SET backup_codes = $1 WHERE id = $2",
            [JSON.stringify(current), effectiveUserId],
          );
          await lockClient.query("COMMIT");
          verified = true;
        }
      } catch (lockErr) {
        await lockClient.query("ROLLBACK").catch(() => {});
        throw lockErr;
      } finally {
        lockClient.release();
      }
    }
  } else if (code) {
    const codeError = Validate.multiple([
      Validate.required(code, "Code"),
      Validate.string(code, "Code", 6, 6),
      Validate.pattern(code, "Code", /^\d{6}$/, "Must be 6 digits"),
    ]);
    if (codeError) return ApiResponse.badRequest(codeError);

    if (method === "email") {
      // Only a sign-in code finishes a sign-in: a step-up code mailed to the
      // same account is refused here (lib/auth/email-codes.ts). Consumed with
      // DELETE ... RETURNING, so two concurrent requests with the same code
      // cannot both open a session.
      verified = await consumeEmailCode(effectiveUserId, "login", code);
    } else {
      // Verify TOTP code (app-based)
      if (!user.totp_secret) {
        return ApiResponse.badRequest("2FA is not configured properly.");
      }
      // crypto: TOTP seed is stored AES-256-GCM encrypted. Any legacy "plain:"
      // prefixed seeds are rejected — they are treated as misconfigured and
      // force re-enrollment rather than accepting unencrypted seeds at verify time.
      let decryptedSecret: string;
      if (user.totp_secret.startsWith("plain:")) {
        return NextResponse.json(
          {
            error:
              "2FA configuration is invalid. Please disable and re-enable 2FA.",
          },
          { status: 400 },
        );
      }
      try {
        decryptedSecret = decryptApiKey(user.totp_secret);
      } catch {
        return NextResponse.json(
          { error: "2FA is not configured properly." },
          { status: 400 },
        );
      }
      const totpResult = verifyTOTPWithCounter(decryptedSecret, code);
      verified = totpResult.valid;

      if (verified) {
        // TOTP replay prevention: each 30-second time-step may only be used
        // once per account, shared with the staff second factor
        // (lib/auth/totp-step.ts) so a code spent in one place is refused in
        // the other (AUDIT-004#auth-01).
        const fresh = await consumeTotpStep(
          effectiveUserId,
          totpResult.counter as number,
        );
        if (!fresh) {
          return ApiResponse.badRequest(
            "Code already used. Wait for the next 30-second window.",
          );
        }
      }
    }
  }

  if (!verified) {
    return ApiResponse.badRequest("Invalid code. Please try again.");
  }

  // PAUSE_LOGINS (and MAINTENANCE_MODE, which implies it). The second factor
  // is a second door into the same room: the password route refuses a paused
  // non-staff login before it ever issues a pending token, but the Discord
  // and OAuth callbacks issue theirs on a different path, so this step needs
  // its own gate rather than trusting that nobody arrived here.
  //
  // After verification, for the same non-enumeration reason as the password
  // route: only a caller who has already produced a valid code is told.
  const loginsPaused = await loginsPausedResponseFor(user.role);
  if (loginsPaused) return loginsPaused;

  // Create session with IP and user agent
  await createSession(effectiveUserId, ip, userAgent);

  // Get user email for login notification
  const userEmailResult = await pool.query(
    "SELECT email FROM users WHERE id = $1",
    [effectiveUserId],
  );
  const userEmail = userEmailResult.rows[0]?.email;

  // Send new login alert email in background
  if (userEmail) {
    setImmediate(() => {
      sendNotificationEmail({
        userId: effectiveUserId,
        userEmail,
        type: "login_alerts",
        emailContent: newLoginEmail("2FA verified login", ip, {
          ipAddress: ip,
          userAgent,
        }),
      }).catch((err) => console.error("Failed to send login alert:", err));
    });
  }

  // Create response
  const response = NextResponse.json({ success: true });

  // All three, not only the one used: a leftover is a stale first factor.
  for (const name of PENDING_COOKIE_NAMES) response.cookies.delete(name);

  // If user wants to remember this device, set device trust cookie
  // Use the rememberDevice value from the form submission for both normal and Discord logins
  if (rememberDevice === true) {
    // auth: 256-bit opaque random token stored server-side in
    // device_trust (see lib/auth/device-trust.ts).
    const fingerprint = await upsertTrustedDevice(
      effectiveUserId,
      null,
      ip,
      userAgent,
    );
    const deviceTrustMaxAgeDays = await getSetting("DEVICE_TRUST_MAX_AGE_DAYS");
    response.cookies.set(DEVICE_TRUST_COOKIE_NAME, fingerprint, {
      httpOnly: true,
      secure: cookiesRequireHttps(),
      sameSite: "lax",
      path: "/",
      maxAge: deviceTrustMaxAgeDays * 24 * 60 * 60,
    });
  }

  return response;
});

/**
 * POST { purpose: "reauth", code }: the second half of the step-up a
 * password-less account takes before a security change. Consumes a code from
 * POST /auth/2fa/email-send { purpose: "reauth" } once, and answers with the
 * signed step-up cookie lib/auth/reauth.ts accepts for ten minutes on this
 * session only. Needs the session, not a pending cookie, and only a step-up
 * code: a sign-in code mailed to the same account is refused here, as this
 * code is refused by the sign-in path above.
 */
async function verifyStepUp(code: unknown, ip: string) {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized();
  const refused = refuseWhileImpersonating(
    session,
    "Confirming a security change",
  );
  if (refused) return refused;

  if (typeof code !== "string" || !SIX_DIGITS.test(code)) {
    return ApiResponse.badRequest("Enter the 6-digit code from the email.");
  }

  const limited = await twoFactorAttemptLimit(
    session.userId,
    ip,
    "2fa-step-up",
  );
  if (limited) return limited;

  const sessionId = await currentSessionId();
  if (!sessionId) return ApiResponse.unauthorized();

  if (!(await consumeEmailCode(session.userId, "reauth", code))) {
    return ApiResponse.badRequest(
      "That code did not match or has expired. Ask for a new one.",
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(
    STEP_UP_COOKIE,
    signStepUpToken(session.userId, sessionId),
    stepUpCookieOptions(),
  );
  return response;
}
