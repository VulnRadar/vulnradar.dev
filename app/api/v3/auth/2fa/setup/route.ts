import { NextRequest } from "next/server";
import crypto from "crypto";
import { getSession, hashPassword } from "@/lib/auth";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";
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

  const secret = generateSecret();
  const uri = generateOtpAuthUri(secret, session.email);

  // crypto: TOTP seed is stored AES-256-GCM encrypted via the same
  // encryptApiKey pipeline that protects API keys. Without this, a
  // read-only DB compromise yields the user's TOTP seed and lets an
  // attacker mint valid 6-digit codes for the lifetime of the
  // account (full 2FA bypass).
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [
    encryptApiKey(secret),
    session.userId,
  ]);

  // Return the plaintext secret to the user (so they can scan the QR)
  // but persist only the ciphertext.
  return ApiResponse.success({ secret, uri });
});

// POST: Verify the code and enable 2FA
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const parsed = await parseBody<{ code: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { code } = parsed.data;

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

  // crypto: decrypt the stored TOTP seed inline before verification.
  // Fail closed if decryption fails.
  let secret: string;
  try {
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

  // Generate backup codes, hash them, and enable 2FA
  const backupCodes = generateBackupCodes(8);
  const hashedCodes = backupCodes.map((code) =>
    hashPassword(code.replace(/-/g, "").toUpperCase()),
  );
  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'app', backup_codes = $1 WHERE id = $2",
    [JSON.stringify(hashedCodes), session.userId],
  );

  // Send 2FA change notification email (don't await)
  const ip = await getClientIp();
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
