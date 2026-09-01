import { NextRequest } from "next/server";
import crypto from "crypto";
import { getSession, hashPassword } from "@/lib/auth";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";
import {
  generateSecret,
  verifyTOTP,
  generateOtpAuthUri,
} from "@/lib/auth/totp";
import { twoFactorEnabledEmail } from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 bytes (80 bits) per code. The
    // previous `randomBytes(4)` (32 bits) is below NIST 800-63B
    // guidance for backup verification codes. The 2FA verify
    // endpoint rate-limits to 5 attempts per 5 minutes per
    // user+IP, so 32-bit codes were computationally in scope.
    const code = crypto.randomBytes(10).toString("hex").toUpperCase();
    // 20 hex chars, split as XXXXX-XXXXX-XXXXX-XXXXX.
    codes.push(
      `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10, 15)}-${code.slice(15, 20)}`,
    );
  }
  return codes;
}

// GET: Generate a new secret and return the URI for QR code
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // Refuse to overwrite a secret if 2FA is already active.
  // A session cookie holder (e.g. shared browser) must disable 2FA first
  // before re-enrolling — otherwise they could silently brick the account.
  const existing = await pool.query<{ totp_enabled: boolean }>(
    "SELECT totp_enabled FROM users WHERE id = $1",
    [session.userId],
  );
  if (existing.rows[0]?.totp_enabled) {
    return ApiResponse.badRequest(
      "2FA is already enabled. Disable it first before re-enrolling.",
    );
  }

  const secret = generateSecret();
  const uri = generateOtpAuthUri(secret, session.email);

  // TOTP seeds are permanent — unlike passwords they cannot be rotated
  // without re-enrolling the user. Storing them in plaintext means any
  // DB read gives a permanent 2FA bypass. Fail closed if not configured.
  if (!isEncryptionConfigured()) {
    return ApiResponse.error(
      "2FA setup requires server-side encryption to be configured (API_KEY_ENCRYPTION_KEY).",
      503,
    );
  }
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [
    encryptApiKey(secret),
    session.userId,
  ]);

  // Return the plaintext secret to the user (so they can scan the QR)
  // but persist only the ciphertext.
  return ApiResponse.success({ secret, uri });
});

// POST: Verify the code and enable 2FA (requires password confirmation to prevent
// session-hijack-based silent 2FA enrollment)
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  // auth: rate-limit password verification so a stolen session cookie
  // cannot be used to brute-force the account password through this
  // endpoint. Same cap as login (5 attempts / 15 min).
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `2fa-setup:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return ApiResponse.tooManyRequests(
      `Too many attempts. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    );
  }

  const parsed = await parseBody<{ code: string; currentPassword: string }>(
    request,
  );
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { code, currentPassword } = parsed.data;

  // auth: require password re-entry before enabling 2FA. An attacker with
  // only a session cookie cannot silently enroll their own TOTP device.
  // An OAuth-only account has no password to re-enter, so its session is the
  // re-auth signal instead: see verifyReauthPassword. Demanding one here
  // unconditionally made 2FA unreachable for every Google/GitHub/Discord
  // signup.
  const reauth = await verifyReauthPassword(session.userId, currentPassword, {
    missing: "Your current password is required to enable 2FA.",
    wrong: "Password is incorrect.",
  });
  if (!reauth.ok) {
    return reauth.status === 400
      ? ApiResponse.badRequest(reauth.error)
      : ApiResponse.error(reauth.error, 403);
  }

  if (
    !code ||
    typeof code !== "string" ||
    code.length !== 6 ||
    !/^\d{6}$/.test(code)
  ) {
    return ApiResponse.badRequest("Valid 6-digit code required");
  }

  // Get the stored (encrypted) secret
  const result = await pool.query(
    "SELECT totp_secret FROM users WHERE id = $1",
    [session.userId],
  );
  const storedSecret = result.rows[0]?.totp_secret;
  if (!storedSecret) {
    return ApiResponse.badRequest(
      "No 2FA setup in progress. Start setup first.",
    );
  }

  // Decrypt the stored TOTP seed. Any legacy "plain:" prefixed secrets
  // (written before the fail-closed policy) are treated as invalid and
  // force re-enrollment rather than accepting plaintext seeds at runtime.
  let secret: string;
  try {
    if (storedSecret.startsWith("plain:")) {
      // Clear the invalid plaintext seed to force re-enrollment.
      await pool.query("UPDATE users SET totp_secret = NULL WHERE id = $1", [
        session.userId,
      ]);
      return ApiResponse.badRequest(
        "2FA setup must be restarted (encryption now required). Please begin setup again.",
      );
    }
    secret = decryptApiKey(storedSecret);
  } catch {
    return ApiResponse.badRequest(
      "No 2FA setup in progress. Start setup first.",
    );
  }

  // Verify the code
  if (!verifyTOTP(secret, code)) {
    return ApiResponse.badRequest(
      "Invalid code. Check your authenticator app and try again.",
    );
  }

  // Generate backup codes, hash them, and enable 2FA.
  // auth: record the time-step used during setup so it cannot be
  // replayed at the 2FA login prompt within the same 30-second window.
  // Without this, totp_last_counter stays NULL and the verify route
  // skips the replay check for the very first login after setup.
  const backupCodes = generateBackupCodes(8);
  const hashedCodes = await Promise.all(
    backupCodes.map((code) =>
      hashPassword(code.replace(/-/g, "").toUpperCase()),
    ),
  );
  const setupStepCounter = String(BigInt(Math.floor(Date.now() / 1000 / 30)));
  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'app', backup_codes = $1, totp_last_counter = $2 WHERE id = $3",
    [JSON.stringify(hashedCodes), setupStepCounter, session.userId],
  );

  // Send 2FA change notification email (don't await)
  const userAgent = await getUserAgent();

  const emailContent = twoFactorEnabledEmail({ ipAddress: ip, userAgent });
  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "two_factor_changes",
    emailContent,
  }).catch((err) =>
    console.error(
      "[Email Error] Failed to send 2FA enabled notification:",
      err,
    ),
  );

  return ApiResponse.success({
    message: SUCCESS_MESSAGES.TWO_FA_ENABLED,
    backupCodes,
  });
});
