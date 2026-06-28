import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
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
  DEVICE_TRUST_MAX_AGE,
  ERROR_MESSAGES,
} from "@/lib/config/constants";
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

  // Verify the pending 2FA token (check both normal login and Discord login pending cookies)
  const pending = request.cookies.get(AUTH_2FA_PENDING_COOKIE)?.value;
  const discordPending = request.cookies.get("discord_pending_login")?.value;

  let isDiscordLogin = false;
  let effectiveUserId = userId;
  let parsedDiscordPending: {
    userId: number;
    token: string;
    ts: number;
  } | null = null;

  // Check for Discord pending login first (userId might be 0 from client)
  if (discordPending) {
    try {
      parsedDiscordPending = JSON.parse(discordPending);
      if (parsedDiscordPending) {
        isDiscordLogin = true;
        effectiveUserId = parsedDiscordPending.userId;
        // Check if Discord pending token is expired (5 minutes)
        if (Date.now() - parsedDiscordPending.ts > 5 * 60 * 1000) {
          return ApiResponse.unauthorized(
            "Discord login session expired. Please try again.",
          );
        }
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  // H-6: rate-limit 2FA attempts per userId (5 / 5 min). The previous
  // implementation only rate-limited the email-2FA *send* endpoint; the
  // primary /verify endpoint had no per-user cap, allowing brute force
  // of 6-digit TOTP codes (10^6 ≈ 20 bits) once an attacker knew or
  // guessed a userId.
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

  if (!isDiscordLogin) {
    if (!userId) {
      return ApiResponse.badRequest("User ID is required");
    }
    // H-6: timing-safe compare of the pending cookie. The previous
    // implementation used `pending !== String(userId)` which is fine
    // for distinct string equality but exposes a side-channel if the
    // format ever changes (e.g. hashed pending). The constant-length
    // compare below is the safe default.
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
      const matchIndex = storedHashes.findIndex((hash: string) => {
        try {
          return verifyPassword(normalizedInput, hash);
        } catch {
          return false;
        }
      });
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
      const claim = await pool.query<{ id: number }>(
        `DELETE FROM email_2fa_codes
          WHERE id = (
            SELECT id FROM email_2fa_codes
            WHERE user_id = $1
              AND code_hash = encode(sha256($2::bytea), 'hex')
              AND expires_at > NOW()
            LIMIT 1
          )
          RETURNING id`,
        [effectiveUserId, code],
      );
      if (claim.rowCount && claim.rowCount > 0) {
        verified = true;
      }
    } else {
      // Verify TOTP code (app-based)
      if (!user.totp_secret) {
        return ApiResponse.badRequest("2FA is not configured properly.");
      }
      // SECURITY-AUDIT-2026-06-28 / H-3: TOTP seed is stored AES-256-GCM
      // encrypted. Decrypt inline at verify time so the plaintext seed
      // never leaves memory. If decryption fails (corrupt / key mismatch),
      // fail closed.
      let decryptedSecret: string;
      try {
        decryptedSecret = decryptApiKey(user.totp_secret);
      } catch {
        return NextResponse.json(
          { error: "2FA is not configured properly." },
          { status: 400 },
        );
      }
      verified = verifyTOTP(decryptedSecret, code);
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
  if (isDiscordLogin) {
    response.cookies.delete("discord_pending_login");
  }

  // If user wants to remember this device, set device trust cookie
  // Use the rememberDevice value from the form submission for both normal and Discord logins
  if (rememberDevice === true) {
    // H-3: 256-bit opaque random token stored server-side in device_trust.
    const fingerprint = await upsertTrustedDevice(
      effectiveUserId,
      null,
      ip,
      userAgent,
    );
    response.cookies.set(DEVICE_TRUST_COOKIE_NAME, fingerprint, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_TRUST_MAX_AGE,
    });
  }

  return response;
});
