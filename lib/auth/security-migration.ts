/**
 * crypto: one-time encryption migration for the TOTP seed and
 * Discord OAuth tokens.
 *
 * The schema columns `users.totp_secret`,
 * `discord_connections.access_token`, and
 * `discord_connections.refresh_token` are now stored as AES-256-GCM
 * ciphertexts (base64) using the same `encryptApiKey` /
 * `decryptApiKey` pipeline that protects API keys.
 *
 * A plaintext TOTP seed is a 32-char uppercase base32 string.
 * A plaintext Discord token is a 24-30+ char alphanumeric string.
 * An AES-256-GCM ciphertext under this pipeline is always a base64
 * string that begins with a 16-byte (IV = 12 bytes + ≥4 bytes
 * ciphertext) prefix. So a stored value that:
 *   - is non-null,
 *   - cannot be successfully base64-decoded and split into
 *     IV/ciphertext/tag, OR
 *   - base64-decodes but does not match the expected
 *     `iv(12)+cipher+tag(16)` layout,
 * is treated as legacy plaintext and is re-encrypted in place.
 *
 * Safe to run repeatedly: if a row is already encrypted,
 * `decryptApiKey` succeeds and we leave it alone. Idempotent.
 */
import pool from "@/lib/database/db";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";

/**
 * Returns true if the input looks like a valid AES-256-GCM ciphertext
 * emitted by `encryptApiKey`. Used to discriminate plaintext from
 * ciphertext during the migration.
 */
function looksEncrypted(value: string): boolean {
  if (!value || value.length < 28) return false;
  // base64 alphabet only
  if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return false;
  }
  // Encrypted layout: IV(12) + ciphertext(>=1) + tag(16) = at least 29 bytes.
  if (buf.length < 29) return false;
  // Decrypt must succeed.
  try {
    decryptApiKey(value);
    return true;
  } catch {
    return false;
  }
}

interface MigrationStats {
  totpScanned: number;
  totpReEncrypted: number;
  totpAlreadyEncrypted: number;
  totpUnreadable: number;
  discordScanned: number;
  discordReEncrypted: number;
  discordAlreadyEncrypted: number;
  discordUnreadable: number;
}

/**
 * Re-encrypt every plaintext TOTP seed and Discord token in the DB.
 * Idempotent. Safe to call from instrumentation.ts on every boot.
 */
export async function migratePlaintextSecretsToEncrypted(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    totpScanned: 0,
    totpReEncrypted: 0,
    totpAlreadyEncrypted: 0,
    totpUnreadable: 0,
    discordScanned: 0,
    discordReEncrypted: 0,
    discordAlreadyEncrypted: 0,
    discordUnreadable: 0,
  };

  // --- TOTP ---
  try {
    const totpRows = await pool.query<{
      id: number;
      totp_secret: string | null;
    }>("SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL");
    stats.totpScanned = totpRows.rows.length;
    for (const row of totpRows.rows) {
      const v = row.totp_secret;
      if (!v) continue;
      if (looksEncrypted(v)) {
        stats.totpAlreadyEncrypted++;
        continue;
      }
      try {
        const encrypted = encryptApiKey(v);
        await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [
          encrypted,
          row.id,
        ]);
        stats.totpReEncrypted++;
      } catch (err) {
        stats.totpUnreadable++;
        console.error(
          `[security-migration] Failed to encrypt totp_secret for user ${row.id}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error("[security-migration] TOTP migration query failed:", err);
  }

  // --- Discord ---
  try {
    const discordRows = await pool.query<{
      user_id: number;
      access_token: string;
      refresh_token: string;
    }>("SELECT user_id, access_token, refresh_token FROM discord_connections");
    stats.discordScanned = discordRows.rows.length;
    for (const row of discordRows.rows) {
      let needsAccess = !looksEncrypted(row.access_token);
      let needsRefresh = !looksEncrypted(row.refresh_token);

      if (!needsAccess && !needsRefresh) {
        stats.discordAlreadyEncrypted++;
        continue;
      }

      try {
        const newAccess = needsAccess
          ? encryptApiKey(row.access_token)
          : row.access_token;
        const newRefresh = needsRefresh
          ? encryptApiKey(row.refresh_token)
          : row.refresh_token;
        await pool.query(
          "UPDATE discord_connections SET access_token = $1, refresh_token = $2 WHERE user_id = $3",
          [newAccess, newRefresh, row.user_id],
        );
        if (needsAccess) stats.discordReEncrypted++;
        if (needsRefresh) stats.discordReEncrypted++;
      } catch (err) {
        stats.discordUnreadable++;
        console.error(
          `[security-migration] Failed to encrypt Discord tokens for user ${row.user_id}:`,
          err,
        );
      }
    }
  } catch (err) {
    console.error("[security-migration] Discord migration query failed:", err);
  }

  if (
    stats.totpReEncrypted > 0 ||
    stats.discordReEncrypted > 0 ||
    stats.totpUnreadable > 0 ||
    stats.discordUnreadable > 0
  ) {
    console.log(
      `[security-migration] Plaintext-to-encrypted backfill complete: ` +
        `totp re-encrypted=${stats.totpReEncrypted} (skipped=${stats.totpAlreadyEncrypted}, unreadable=${stats.totpUnreadable}); ` +
        `discord re-encrypted=${stats.discordReEncrypted} (skipped=${stats.discordAlreadyEncrypted}, unreadable=${stats.discordUnreadable}).`,
    );
  }

  return stats;
}
