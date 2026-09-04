import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { createSession, verifyPassword } from "@/lib/auth";
import { decryptApiKey } from "@/lib/auth/crypto";
import { verifyTOTPWithCounter } from "@/lib/auth/totp";
import pool from "@/lib/database/db";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { newLoginEmail } from "@/lib/email/email";
import {
  ApiResponse,
  parseBody,
  Validate,
  withErrorHandling,
} from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { verifyPendingToken } from "@/lib/auth/pending-2fa";
import {
  AUTH_2FA_PENDING_COOKIE,
  DEVICE_TRUST_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { upsertTrustedDevice } from "@/lib/auth/device-trust";
import { loginsPausedResponseFor } from "@/lib/admin/service-state";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp();
  const userAgent = await getUserAgent();

  const parsed = await parseBody<{
    userId: number;
    code?: string;
    backupCode?: string;
    rememberDevice?: boolean;
  }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  // `userId` from the body is intentionally NOT destructured: it must never be
  // trusted for authorization. The effective user id comes only from a signed
  // pending cookie below (lib/auth/pending-2fa.ts).
  const { code, backupCode, rememberDevice } = parsed.data;

  const validationError = Validate.multiple([
    Validate.required(code || backupCode, "Code or backup code"),
  ]);
  if (validationError) return ApiResponse.badRequest(validationError);

  // Verify the pending 2FA token. Three possible sources: a normal
  // password login (AUTH_2FA_PENDING_COOKIE), the existing Discord
  // account-linking login (discord_pending_login), or a Google/GitHub/
  // Discord OAuth sign-in from app/api/v3/auth/oauth/[provider]/callback
  // (oauth_pending_login). The last two carry the userId in the cookie
  // itself rather than the request body, since they arrive via a full-page
  // redirect with no client-side state to attach it to.
  const pending = request.cookies.get(AUTH_2FA_PENDING_COOKIE)?.value;
  const discordPending = request.cookies.get("discord_pending_login")?.value;
  const oauthPending = request.cookies.get("oauth_pending_login")?.value;

  let usingThirdPartyPendingCookie = false;
  let thirdPartyPendingCookieName:
    "discord_pending_login" | "oauth_pending_login" | null = null;
  // The user id is ONLY ever taken from a cryptographically-signed pending
  // cookie (lib/auth/pending-2fa.ts), never from the request body. The body's
  // userId used to be trusted after a compare against a forgeable cookie, which
  // let anyone reach a victim's 2FA step without their password.
  let effectiveUserId = 0;
  const pendingMaxAgeMs =
    (await getSetting("2FA_PENDING_MAX_AGE_SECONDS")) * 1000;

  // Check for a third-party pending login first. Discord takes priority only
  // because both could never realistically be set at once (each callback sets
  // exactly one).
  const thirdPartyPendingRaw = discordPending ?? oauthPending;
  if (thirdPartyPendingRaw) {
    thirdPartyPendingCookieName = discordPending
      ? "discord_pending_login"
      : "oauth_pending_login";
    const parsed = verifyPendingToken<{ userId: number; ts: number }>(
      thirdPartyPendingRaw,
    );
    if (parsed && typeof parsed.userId === "number") {
      usingThirdPartyPendingCookie = true;
      effectiveUserId = parsed.userId;
      // Freshness: same admin-configurable window the password-login pending
      // cookie uses (2FA_PENDING_MAX_AGE_SECONDS), so raising one raises both.
      if (Date.now() - parsed.ts > pendingMaxAgeMs) {
        return ApiResponse.unauthorized(
          thirdPartyPendingCookieName === "discord_pending_login"
            ? "Discord login session expired. Please try again."
            : "That sign-in session expired. Please try again.",
        );
      }
    }
  }

  if (!usingThirdPartyPendingCookie) {
    const parsed = verifyPendingToken<{ userId: number; ts: number }>(pending);
    if (!parsed || typeof parsed.userId !== "number") {
      return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION);
    }
    if (Date.now() - parsed.ts > pendingMaxAgeMs) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION);
    }
    effectiveUserId = parsed.userId;
  }

  // auth: rate-limit 2FA attempts (admin-configurable, default 5 / 5 min --
  // RATE_LIMIT_2FA_VERIFY_ATTEMPTS/WINDOW_MINUTES). Two buckets: one keyed by
  // (user, ip) and one keyed by user alone, so an attacker who already holds
  // the password (and thus a valid signed pending cookie) can't brute-force the
  // 6-digit code by rotating source IPs to reset the per-ip bucket.
  if (effectiveUserId) {
    for (const key of [
      `2fa-verify:${effectiveUserId}:${ip}`,
      `2fa-verify-user:${effectiveUserId}`,
    ]) {
      const rl = await checkRateLimit({
        key,
        ...RATE_LIMITS.twoFactorVerify,
      });
      if (!rl.allowed) {
        return ApiResponse.tooManyRequests(
          `Too many 2FA attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
        );
      }
    }
  }

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
    // Hold a row-level lock for the entire read-modify-write cycle so two
    // concurrent attempts can't both observe the same hash, both splice it
    // out, and both UPDATE — which would otherwise let a single backup
    // code be replayed once.
    const normalizedInput = backupCode
      .trim()
      .toUpperCase()
      .replace(/[\s-]/g, "");
    const lockClient = await pool.connect();
    try {
      await lockClient.query("BEGIN");
      const lockResult = await lockClient.query(
        "SELECT backup_codes FROM users WHERE id = $1 FOR UPDATE",
        [effectiveUserId],
      );
      const storedHashes: string[] = lockResult.rows[0]?.backup_codes
        ? JSON.parse(lockResult.rows[0].backup_codes)
        : [];
      // Compare against every stored code before picking a match. Checking
      // them all in parallel keeps the work off the event loop and makes the
      // response time independent of which slot matched, so the timing does
      // not reveal a code's position.
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
      if (matchIndex < 0) {
        await lockClient.query("ROLLBACK");
      } else {
        storedHashes.splice(matchIndex, 1);
        await lockClient.query(
          "UPDATE users SET backup_codes = $1 WHERE id = $2",
          [JSON.stringify(storedHashes), effectiveUserId],
        );
        verified = true;
        await lockClient.query("COMMIT");
      }
    } catch (lockErr) {
      await lockClient.query("ROLLBACK").catch(() => {});
      throw lockErr;
    } finally {
      lockClient.release();
    }
  } else if (code) {
    const codeError = Validate.multiple([
      Validate.required(code, "Code"),
      Validate.string(code, "Code", 6, 6),
      Validate.pattern(code, "Code", /^\d{6}$/, "Must be 6 digits"),
    ]);
    if (codeError) return ApiResponse.badRequest(codeError);

    if (method === "email") {
      // Verify email 2FA code. Atomically consume the matching row so two
      // concurrent requests with the same code cannot both pass verification
      // (the prior SELECT+DELETE pattern let the second request reuse
      // the just-matched code and open a parallel authenticated session).
      // L-2: look up the row, then in Node verify the salted hash
      // (sha256(code_salt:code)). Doing the hash in Node avoids SQL-
      // injection-style hash comparison tricks.
      // Pull code_hash alongside code_salt in the one query rather than
      // re-selecting it per candidate row (was a query-per-row loop).
      const candidate = await pool.query<{
        id: number;
        code_salt: string;
        code_hash: string;
      }>(
        `SELECT id, code_salt, code_hash FROM email_2fa_codes
         WHERE user_id = $1
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 5`,
        [effectiveUserId],
      );
      let matched: { id: number } | null = null;
      for (const row of candidate.rows) {
        const expected = createHash("sha256")
          .update(`${row.code_salt}:${code}`)
          .digest("hex");
        const storedHash = row.code_hash;
        const expectedBuf = Buffer.from(expected, "hex");
        const storedBuf = Buffer.from(storedHash ?? "", "hex");
        if (
          storedHash &&
          expectedBuf.length === storedBuf.length &&
          timingSafeEqual(expectedBuf, storedBuf)
        ) {
          matched = { id: row.id };
          break;
        }
      }
      if (matched) {
        // auth: use RETURNING to atomically verify a row was actually
        // deleted. Without this, two concurrent requests with the same
        // code both run the DELETE (first wins, second deletes 0 rows
        // but pg doesn't error), and both would have set verified = true
        // before the DELETE — opening a parallel authenticated session.
        const del = await pool.query<{ id: number }>(
          "DELETE FROM email_2fa_codes WHERE id = $1 RETURNING id",
          [matched.id],
        );
        if (del.rows.length > 0) {
          verified = true;
        }
      }
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
        // once per account. Lock the row, compare against the stored counter,
        // and advance it atomically so two concurrent requests with the same
        // code can't both pass (AUDIT-004#auth-01). Key the guard on the
        // step the code actually matched, not the current wall-clock step:
        // a code is valid for +/- window steps, so using the wall-clock step
        // would let the same code be replayed once per step it stays valid.
        const stepCounter = BigInt(totpResult.counter as number);
        const stepClient = await pool.connect();
        let replayDetected = false;
        try {
          await stepClient.query("BEGIN");
          const cRow = await stepClient.query(
            "SELECT totp_last_counter FROM users WHERE id = $1 FOR UPDATE",
            [effectiveUserId],
          );
          const last = cRow.rows[0]?.totp_last_counter;
          if (
            last !== null &&
            last !== undefined &&
            BigInt(last) >= stepCounter
          ) {
            replayDetected = true;
            await stepClient.query("ROLLBACK");
          } else {
            await stepClient.query(
              "UPDATE users SET totp_last_counter = $1 WHERE id = $2",
              [String(stepCounter), effectiveUserId],
            );
            await stepClient.query("COMMIT");
          }
        } catch (e) {
          await stepClient.query("ROLLBACK").catch(() => {});
          throw e;
        } finally {
          stepClient.release();
        }
        if (replayDetected) {
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

  // Clear the pending cookies
  response.cookies.delete(AUTH_2FA_PENDING_COOKIE);
  if (thirdPartyPendingCookieName) {
    response.cookies.delete(thirdPartyPendingCookieName);
  }

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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: deviceTrustMaxAgeDays * 24 * 60 * 60,
    });
  }

  return response;
});
