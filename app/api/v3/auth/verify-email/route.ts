import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { SUCCESS_MESSAGES } from "@/lib/config/constants";
import { authTokenHashCandidates } from "@/lib/auth/token-hash";
import { sendEmail, emailVerifiedEmail } from "@/lib/email/email";

// auth: hash the incoming token with the same function used at generation
// so a DB dump can't replay raw tokens. The candidate list is the HMAC
// digest plus the pre-HMAC sha256 one, so a verification link already sent
// when the switch to HMAC shipped still works (AUDIT-002#secrets-03).

export const POST = withErrorHandling(async (request: NextRequest) => {
  const parsed = await parseBody<{ token: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { token } = parsed.data;

  if (!token || typeof token !== "string") {
    return ApiResponse.badRequest("Verification token is required.");
  }

  const tokenHashes = authTokenHashCandidates(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find valid token
    const tokenRes = await client.query(
      `SELECT evt.id, evt.user_id, evt.expires_at, u.email, u.name, u.email_verified_at
       FROM email_verification_tokens evt
       JOIN users u ON evt.user_id = u.id
       WHERE evt.token_hash = ANY($1::text[]) AND evt.used_at IS NULL
       FOR UPDATE`,
      [tokenHashes],
    );

    if (tokenRes.rows.length === 0) {
      await client.query("ROLLBACK");
      // Check if token exists but was already used
      const usedTokenRes = await client.query(
        "SELECT id, used_at FROM email_verification_tokens WHERE token_hash = ANY($1::text[])",
        [tokenHashes],
      );
      if (usedTokenRes.rows.length > 0) {
        return ApiResponse.badRequest(
          "This verification link has already been used.",
        );
      }
      return ApiResponse.badRequest("Invalid or expired verification link.");
    }

    const verificationToken = tokenRes.rows[0];

    // Check if already verified
    if (verificationToken.email_verified_at) {
      await client.query("ROLLBACK");
      return ApiResponse.success({
        message: "Email already verified. You can log in.",
        alreadyVerified: true,
      });
    }

    // Check expiration
    if (new Date(verificationToken.expires_at) < new Date()) {
      await client.query(
        "DELETE FROM email_verification_tokens WHERE id = $1",
        [verificationToken.id],
      );
      await client.query("COMMIT");
      return ApiResponse.badRequest(
        "This verification link has expired. Please request a new one.",
      );
    }

    // Mark email as verified
    await client.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1",
      [verificationToken.user_id],
    );

    // Mark token as used
    await client.query(
      "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1",
      [verificationToken.id],
    );

    await client.query("COMMIT");

    // The verification mail covers the request; nothing covered the result, so
    // a new account's first successful action produced silence. Sent once,
    // because the already-verified branch above returns before reaching here.
    void (async () => {
      try {
        await sendEmail({
          to: verificationToken.email,
          ...emailVerifiedEmail(verificationToken.name),
        });
      } catch (err) {
        console.error("[Email Error] Verified-confirmation email failed:", err);
      }
    })();

    return ApiResponse.success({
      message: SUCCESS_MESSAGES.EMAIL_VERIFIED,
      verified: true,
      user: {
        email: verificationToken.email,
        name: verificationToken.name,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// GET endpoint for when user clicks the link directly
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_token", request.url),
    );
  }

  // Redirect to the verify-email page which will handle the verification
  return NextResponse.redirect(
    new URL(`/verify-email?token=${token}`, request.url),
  );
}
