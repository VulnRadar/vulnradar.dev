import pool from "@/lib/database/db";
import { email2FACodeEmail, sendEmail } from "@/lib/email/email";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";
import { randomInt } from "node:crypto";

/**
 * Generate and send email 2FA code for Discord login
 * Runs asynchronously in background without blocking the response
 */
export async function sendDiscordEmail2FACode(
  userId: number,
  userEmail: string,
): Promise<void> {
  try {
    // Delete old codes for this user
    await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [
      userId,
    ]);

    // Generate 6-digit code
    const code = randomInt(100000, 999999).toString();

    // Store hashed code with 10 min expiry
    await pool.query(
      "INSERT INTO email_2fa_codes (user_id, code_hash, expires_at) VALUES ($1, encode(sha256($2::bytea), 'hex'), NOW() + INTERVAL '10 minutes')",
      [userId, code],
    );

    // Send the email
    const emailContent = email2FACodeEmail(code);
    await sendEmail({
      to: userEmail,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
  } catch (error) {
    console.error("[Discord Email 2FA]", error);
    // Don't rethrow - this is background operation
  }
}

/**
 * Update Discord connection tokens
 */
export async function updateDiscordTokens(
  discordId: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: Date,
  guildJoined: boolean,
): Promise<void> {
  // crypto: tokens encrypted at rest via encryptApiKey.
  await pool.query(
    `UPDATE discord_connections SET 
     access_token = $1, refresh_token = $2, token_expires_at = $3,
     guild_joined = $4, updated_at = NOW()
     WHERE discord_id = $5`,
    [
      encryptApiKey(accessToken),
      encryptApiKey(refreshToken),
      tokenExpiresAt,
      guildJoined,
      discordId,
    ],
  );
}

/**
 * Fetch and decrypt the stored Discord access + refresh tokens for a
 * given user. The column values are AES-256-GCM ciphertexts; the
 * plaintext is only materialised in the caller's memory for the
 * duration of one Discord API call.
 *
 * Returns null if the user has no linked Discord account, throws on
 * a decrypt failure (indicates key rotation / corruption / tampering).
 */
export async function getDiscordTokens(userId: number): Promise<{
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  guildJoined: boolean;
} | null> {
  const result = await pool.query(
    "SELECT access_token, refresh_token, token_expires_at, guild_joined FROM discord_connections WHERE user_id = $1",
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    accessToken: decryptApiKey(row.access_token),
    refreshToken: decryptApiKey(row.refresh_token),
    tokenExpiresAt: row.token_expires_at,
    guildJoined: row.guild_joined,
  };
}

/**
 * Check if Discord account is linked to a user
 */
export async function getDiscordUserConnection(
  discordId: string,
): Promise<number | null> {
  const result = await pool.query(
    "SELECT user_id FROM discord_connections WHERE discord_id = $1",
    [discordId],
  );
  return result.rows[0]?.user_id || null;
}

/**
 * Get user's 2FA configuration
 */
export async function getUserTwoFAConfig(userId: number): Promise<{
  totp_enabled: boolean;
  two_factor_method: string;
  email: string;
} | null> {
  const result = await pool.query(
    "SELECT totp_enabled, two_factor_method, email FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0] || null;
}
