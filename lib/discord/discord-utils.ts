import pool from "@/lib/database/db";
import { email2FACodeEmail, sendEmail } from "@/lib/email/email";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";
import { getSetting } from "@/lib/config/runtime-config";
import { randomInt, randomBytes, createHash } from "node:crypto";

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

    // L-2: salted hash. Same shape as the login route's email 2FA.
    const codeSalt = randomBytes(32).toString("hex");
    const codeHash = createHash("sha256")
      .update(`${codeSalt}:${code}`)
      .digest("hex");
    // Read the admin setting, same as the other three insert sites (login,
    // 2fa/email-send, oauth callback). This was a hardcoded INTERVAL '10
    // minutes' literal, so changing EMAIL_2FA_CODE_EXPIRY_MINUTES in the admin
    // panel silently did not apply to the Discord sign-in path.
    const codeExpiryMinutes = await getSetting("EMAIL_2FA_CODE_EXPIRY_MINUTES");
    await pool.query(
      "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))",
      [userId, codeHash, codeSalt, codeExpiryMinutes],
    );

    // Send the email
    const emailContent = email2FACodeEmail(code);
    await sendEmail({
      to: userEmail,
      ...emailContent,
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
 * The stored authorization is gone for good: the user revoked the app in
 * their Discord settings, or the refresh token itself expired. This is a
 * terminal state, not a retryable failure, and the only fix is the user
 * reconnecting. Surfaced to the profile page rather than swallowed, because
 * the alternative is showing "not in server" forever with no explanation.
 */
export class DiscordReauthRequiredError extends Error {
  constructor(message = "Discord authorization is no longer valid.") {
    super(message);
    this.name = "DiscordReauthRequiredError";
  }
}

/** Persist a refreshed token pair. Deliberately leaves guild_joined alone:
 *  refreshing a token says nothing about server membership. */
export async function updateDiscordTokensForUser(
  userId: number,
  accessToken: string,
  refreshToken: string,
  tokenExpiresAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE discord_connections SET
     access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = NOW()
     WHERE user_id = $4`,
    [
      encryptApiKey(accessToken),
      encryptApiKey(refreshToken),
      tokenExpiresAt,
      userId,
    ],
  );
}

/**
 * Exchange the stored refresh token for a fresh access token, persist the
 * new pair, and hand the access token back.
 *
 * Discord access tokens expire after 7 days. The refresh token that arrives
 * beside them has been written, encrypted and re-encrypted on key rotation
 * since Discord sign-in shipped, and nothing ever spent it: `getDiscordTokens`
 * had no callers outside its own module and no refresh existed at all. The
 * visible symptom was that "auto-join our Discord" worked for a week after
 * connecting and then failed silently forever, leaving the account shown as
 * "not in server".
 *
 * Throws DiscordReauthRequiredError when Discord rejects the refresh token
 * itself (a revoked authorization), and a plain Error for anything
 * transient. Never retries: a caller that wants a retry does one attempt,
 * refreshes, and tries once more.
 */
export async function refreshDiscordAccessToken(
  userId: number,
): Promise<string> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Discord OAuth is not configured on this server (DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET).",
    );
  }

  const stored = await getDiscordTokens(userId);
  if (!stored?.refreshToken) {
    throw new DiscordReauthRequiredError(
      "No stored Discord refresh token to exchange.",
    );
  }

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let code = "";
    try {
      code = JSON.parse(body).error ?? "";
    } catch {
      /* not JSON */
    }
    // invalid_grant is Discord saying the refresh token is dead. A 5xx or a
    // rate limit is not, and must not push the user into reconnecting.
    if (code === "invalid_grant" || response.status === 401) {
      console.error(
        `[Discord] Refresh token rejected for user ${userId} (${code || response.status}).`,
      );
      throw new DiscordReauthRequiredError();
    }
    console.error(
      `[Discord] Token refresh failed with HTTP ${response.status} (${code || "no error code"}).`,
    );
    throw new Error(`Discord token refresh failed (HTTP ${response.status}).`);
  }

  const tokens = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    throw new Error("Discord token refresh returned no usable token pair.");
  }

  const expiresInSeconds =
    typeof tokens.expires_in === "number" && tokens.expires_in > 0
      ? tokens.expires_in
      : 0;
  await updateDiscordTokensForUser(
    userId,
    tokens.access_token,
    tokens.refresh_token,
    new Date(Date.now() + expiresInSeconds * 1000),
  );
  return tokens.access_token;
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
 * Get user's 2FA configuration.
 *
 * `role` is not 2FA configuration, and it is here anyway: the Discord
 * callback is a sign-in path, so it has to run the PAUSE_LOGINS check
 * (lib/admin/service-state.ts), and that check needs the role. Selecting it
 * in the one query this path already makes beats a second round trip on
 * every Discord login.
 */
export async function getUserTwoFAConfig(userId: number): Promise<{
  totp_enabled: boolean;
  two_factor_method: string;
  email: string;
  role: string | null;
} | null> {
  const result = await pool.query(
    "SELECT totp_enabled, two_factor_method, email, role FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0] || null;
}
