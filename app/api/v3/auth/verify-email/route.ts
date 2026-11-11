import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { SUCCESS_MESSAGES } from "@/lib/config/constants";
import { hashAuthToken } from "@/lib/auth/token-hash";
import type { PoolClient } from "pg";
import {
  sendEmail,
  emailVerifiedEmail,
  profileEmailChangedEmail,
} from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";

// auth: a link is looked up by the keyed digest every minting site stores
// (lib/auth/token-hash.ts), so a DB dump can't replay raw tokens
// (AUDIT-002#secrets-03). Only that digest: the pre-HMAC sha256 one could
// match nothing but rows minted before tokens recorded the address they were
// mailed to, and those are refused below whatever they match. A link that
// matches no row, from before the switch or never issued, gets the same
// "expired, request a new one" reply as a link past its expiry.

const RELINK_MESSAGE =
  "This verification link has expired. Please request a new one.";

const ADDRESS_TAKEN_MESSAGE =
  "That address now belongs to another account, so your email address was not changed.";

function sendVerifiedConfirmation(to: string, name: string | null) {
  void (async () => {
    try {
      await sendEmail({ to, ...emailVerifiedEmail(name) });
    } catch (err) {
      console.error("[Email Error] Verified-confirmation email failed:", err);
    }
  })();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Move the account onto the pending address its link was mailed to, inside
 * the caller's open transaction, and finish it.
 *
 * A pending address reserves nothing (signup and OAuth only look at
 * users.email), so another account may hold it by now. Then the pending value
 * and this link are dropped and the account stays where it is: the address
 * belongs to whoever signed up with it. The unique index on LOWER(email) is
 * the last word, for a signup that commits between the check and the write.
 *
 * The old address hears about it as a security notice, which no preference
 * switches off: it is the mail that tells an owner their account moved.
 */
async function swapInPendingAddress(
  client: PoolClient,
  change: {
    tokenId: number;
    userId: number;
    name: string | null;
    oldEmail: string;
    newEmail: string;
  },
): Promise<NextResponse> {
  const taken = await client.query(
    "SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2",
    [change.newEmail, change.userId],
  );
  let swapped: { rowCount: number | null } | null = null;
  if (taken.rows.length === 0) {
    await client.query("SAVEPOINT pending_swap");
    try {
      swapped = await client.query(
        `UPDATE users SET email = pending_email, pending_email = NULL,
                email_verified_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND LOWER(pending_email) = $2`,
        [change.userId, change.newEmail],
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await client.query("ROLLBACK TO SAVEPOINT pending_swap");
    }
  }

  if (!swapped) {
    await client.query(
      "UPDATE users SET pending_email = NULL WHERE id = $1 AND LOWER(pending_email) = $2",
      [change.userId, change.newEmail],
    );
    await client.query("DELETE FROM email_verification_tokens WHERE id = $1", [
      change.tokenId,
    ]);
    await client.query("COMMIT");
    return ApiResponse.conflict(ADDRESS_TAKEN_MESSAGE);
  }
  if (swapped.rowCount !== 1) {
    await client.query("ROLLBACK");
    return ApiResponse.badRequest(RELINK_MESSAGE);
  }

  await client.query(
    "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1",
    [change.tokenId],
  );
  await client.query("COMMIT");

  const ipAddress = (await getClientIp()) || "Unknown";
  const userAgent = (await getUserAgent()) || "Unknown";
  const notice = profileEmailChangedEmail(change.oldEmail, change.newEmail, {
    ipAddress,
    userAgent,
  });
  void sendNotificationEmail({
    userId: change.userId,
    userEmail: change.oldEmail,
    type: "security",
    emailContent: notice,
  }).catch((err) =>
    console.error("[Email Error] Email-changed notice failed:", err),
  );
  sendVerifiedConfirmation(change.newEmail, change.name);

  return ApiResponse.success({
    message: `Your email address is now ${change.newEmail}.`,
    verified: true,
    emailChanged: true,
    user: { email: change.newEmail, name: change.name },
  });
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const parsed = await parseBody<{ token: string }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { token } = parsed.data;

  if (!token || typeof token !== "string") {
    return ApiResponse.badRequest("Verification token is required.");
  }

  const tokenHash = hashAuthToken(token);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find valid token. FOR UPDATE locks the token row and then the user row,
    // the same order auth/update takes them in when it records a new
    // address, so a click racing a change waits for it instead of
    // deadlocking.
    const tokenRes = await client.query(
      `SELECT evt.id, evt.user_id, evt.expires_at, evt.email AS token_email,
              u.email, u.pending_email, u.name, u.email_verified_at
       FROM email_verification_tokens evt
       JOIN users u ON evt.user_id = u.id
       WHERE evt.token_hash = $1 AND evt.used_at IS NULL
       FOR UPDATE`,
      [tokenHash],
    );

    if (tokenRes.rows.length === 0) {
      await client.query("ROLLBACK");
      // Check if token exists but was already used
      const usedTokenRes = await client.query(
        "SELECT id, used_at FROM email_verification_tokens WHERE token_hash = $1",
        [tokenHash],
      );
      if (usedTokenRes.rows.length > 0) {
        return ApiResponse.badRequest(
          "This verification link has already been used.",
        );
      }
      return ApiResponse.badRequest(RELINK_MESSAGE);
    }

    const verificationToken = tokenRes.rows[0];
    const boundEmail: string | null = verificationToken.token_email;
    const currentEmail = String(verificationToken.email).toLowerCase();
    const pendingEmail: string | null = verificationToken.pending_email
      ? String(verificationToken.pending_email).toLowerCase()
      : null;

    // A link proves control of the inbox it was mailed to, and only while the
    // account still uses that address or is waiting to move to it. Without
    // this, signing up as one address and switching the account to someone
    // else's before clicking marked the new address verified, which is what
    // OAuth sign-in and staff invites trust to pick an account. A token from
    // before tokens recorded their address (NULL) cannot be checked, so it is
    // refused the same way, and so is the link for a pending address that a
    // later change has since replaced.
    const forCurrent = Boolean(boundEmail) && boundEmail === currentEmail;
    const forPending =
      !forCurrent && Boolean(boundEmail) && boundEmail === pendingEmail;
    if (!forCurrent && !forPending) {
      await client.query(
        "DELETE FROM email_verification_tokens WHERE id = $1",
        [verificationToken.id],
      );
      await client.query("COMMIT");
      return ApiResponse.badRequest(RELINK_MESSAGE);
    }

    // Already verified says something only about the address the account
    // holds. A link for a pending address is the change itself, and the old
    // address being verified proves nothing about the new one.
    if (forCurrent && verificationToken.email_verified_at) {
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
      return ApiResponse.badRequest(RELINK_MESSAGE);
    }

    if (forPending) {
      return await swapInPendingAddress(client, {
        tokenId: verificationToken.id,
        userId: verificationToken.user_id,
        name: verificationToken.name,
        oldEmail: verificationToken.email,
        newEmail: boundEmail as string,
      });
    }

    // The address is matched again in the write itself, so the flag can only
    // land on the address the token was mailed to.
    const verified = await client.query(
      "UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND LOWER(email) = $2",
      [verificationToken.user_id, boundEmail],
    );
    if (verified.rowCount !== 1) {
      await client.query("ROLLBACK");
      return ApiResponse.badRequest(RELINK_MESSAGE);
    }

    // Mark token as used
    await client.query(
      "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1",
      [verificationToken.id],
    );

    await client.query("COMMIT");

    // The verification mail covers the request; nothing covered the result, so
    // a new account's first successful action produced silence. Sent once,
    // because the already-verified branch above returns before reaching here.
    sendVerifiedConfirmation(verificationToken.email, verificationToken.name);

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
