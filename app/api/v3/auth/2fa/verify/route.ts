import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { createSession, verifyPassword } from "@/lib/auth";
import { decryptApiKey } from "@/lib/auth/crypto";
import { verifyTOTP } from "@/lib/auth/totp";
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
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import {
  AUTH_2FA_PENDING_COOKIE,
  DEVICE_TRUST_COOKIE_NAME,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { upsertTrustedDevice } from "@/lib/auth/device-trust";

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
  const { userId, code, backupCode, rememberDevice } = parsed.data;

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
  let effectiveUserId = userId;
  let parsedThirdPartyPending: {
    userId: number;
    ts: number;
  } | null = null;

  // Check for a third-party pending login first (userId might be 0 from
  // client). Discord takes priority only because both could never
  // realistically be set at once (each callback sets exactly one).
  const thirdPartyPendingRaw = discordPending ?? oauthPending;
  if (thirdPartyPendingRaw) {
    thirdPartyPendingCookieName = discordPending
      ? "discord_pending_login"
      : "oauth_pending_login";
    try {
      parsedThirdPartyPending = JSON.parse(thirdPartyPendingRaw);
      if (parsedThirdPartyPending) {
        usingThirdPartyPendingCookie = true;
        effectiveUserId = parsedThirdPartyPending.userId;
        // Check if the pending token is expired (5 minutes)
        if (Date.now() - parsedThirdPartyPending.ts > 5 * 60 * 1000) {
          return ApiResponse.unauthorized(
            thirdPartyPendingCookieName === "discord_pending_login"
              ? "Discord login session expired. Please try again."
              : "That sign-in session expired. Please try again.",
          );
        }
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // auth: rate-limit 2FA attempts per userId (5 / 5 min). The verify
  // endpoint had no per-user cap — only the email-2FA *send*
  // endpoint was throttled, which left brute force of 6-digit TOTP
  // codes (10^6 ≈ 20 bits) open to anyone who knew a userId.
  if (effectiveUserId) {
    const rl = await checkRateLimit({
      key: `2fa-verify:${effectiveUserId}:${ip}`,
      maxAttempts: 5,
      windowSeconds: 5 * 60,
    });
    if (!rl.allowed) {
      return ApiResponse.tooManyRequests(
        `Too many 2FA attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      );
    }
  }

  if (!usingThirdPartyPendingCookie) {
    if (!userId) {
      return ApiResponse.badRequest("User ID is required");
    }
    // auth: timing-safe compare of the pending cookie. Plain
    // `pending !== String(userId)` is fine for distinct equality but
    // exposes a side-channel if the format ever changes (e.g.
    // hashed pending). Constant-length compare is the safe default.
    if (!pending) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION);
    }
    const expected = Buffer.from(String(userId), "utf8");
    const actual = Buffer.from(pending, "utf8");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION);
    }
  }

  // Get user's TOTP secret, backup codes, and 2FA method
  const result = await pool.query(
    "SELECT totp_secret, totp_enabled, backup_codes, two_factor_method FROM users WHERE id = $1",
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
      const candidate = await pool.query<{ id: number; code_salt: string }>(
        `SELECT id, code_salt FROM email_2fa_codes
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
        const stored = await pool.query<{ code_hash: string }>(
          "SELECT code_hash FROM email_2fa_codes WHERE id = $1",
          [row.id],
        );
        const storedHash = stored.rows[0]?.code_hash;
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
      verified = verifyTOTP(decryptedSecret, code);

      if (verified) {
        // TOTP replay prevention: each 30-second time-step may only be used
        // once per account. Lock the row, compare against the stored counter,
        // and advance it atomically so two concurrent requests with the same
        // code can't both pass (AUDIT-004#auth-01).
        const stepCounter = BigInt(Math.floor(Date.now() / 1000 / 30));
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
