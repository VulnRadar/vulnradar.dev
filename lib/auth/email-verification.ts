import { randomBytes, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import pool from "@/lib/database/db";
import { sendEmail, emailVerificationEmail } from "@/lib/email/email";
import { APP_URL } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

/**
 * Mint a fresh single-use email-verification token for a user and send the
 * verification link (fire-and-forget). Stores sha256(token) so verify-email
 * matches on the hash, never the raw token, and clears any prior tokens for
 * the user first so only the newest link is live.
 *
 * Shared by resend-verification and the profile email-change path so both
 * mint/store/send identically -- previously only resend-verification did
 * this, so changing your email left email_verified_at NULL with no link ever
 * sent, stranding the account until the user manually hit resend.
 *
 * Pass `client` to run the token write inside a caller's transaction (e.g.
 * the same statement that flips email_verified_at to NULL); omit it to use
 * the shared pool.
 */
export async function sendEmailVerification(
  userId: number,
  name: string | null,
  email: string,
  client?: PoolClient,
): Promise<void> {
  const db = client ?? pool;
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const emailVerificationHours = await getSetting("EMAIL_VERIFICATION_HOURS");
  const expiresAt = new Date(
    Date.now() + emailVerificationHours * 60 * 60 * 1000,
  );

  await db.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [
    userId,
  ]);
  await db.query(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt],
  );

  const verifyLink = `${APP_URL}/verify-email?token=${token}`;
  const emailContent = emailVerificationEmail(name || "there", verifyLink);
  const to = email.toLowerCase().trim();
  setImmediate(() => {
    sendEmail({
      to,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    }).catch((err) => {
      console.error("[Email Error] Failed to send verification email:", err);
    });
  });
}
