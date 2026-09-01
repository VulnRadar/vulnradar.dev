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
 *
 * Also safe across a key rotation: a value that is ciphertext-shaped but does
 * not decrypt under the current key is classified `unreadable` and skipped
 * rather than re-encrypted. See classifySecret below.
 */
import pool from "@/lib/database/db";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";

/**
 * Three states, not two. The original two-state `looksEncrypted` returned
 * false both for "this is legacy plaintext" and for "this is ciphertext I
 * cannot read", and the caller re-encrypts everything that comes back false.
 * That made a key rotation destructive: rotate API_KEY_ENCRYPTION_KEY (or
 * restore a backup taken under a different key, or copy an .env between
 * environments) and the next boot re-encrypts every existing ciphertext as if
 * it were plaintext, permanently losing the original TOTP seeds and Discord
 * tokens while counting the rows as a successful migration. The failure mode
 * is written up in scripts/_lib/_lib.2fa-crypto-mirror.mjs.
 *
 * "unreadable" is the fail-safe state: a value that is shaped like one of our
 * ciphertexts but does not decrypt is left strictly alone and reported, so a
 * mis-set key is a loud no-op instead of a silent one-way corruption.
 */
type SecretState = "encrypted" | "plaintext" | "unreadable";

// A plaintext TOTP seed is RFC 4648 base32 of 20 random bytes
// (lib/auth/totp.ts generateSecret): 32 chars over A-Z and 2-7 only, so it can
// never contain a lowercase letter, 0, 1, 8, 9, '+' or '/'. Matching this
// first keeps a genuine seed out of the ciphertext-shape branch below, since
// 32 base32 chars also happen to be decodable as base64.
const BASE32_SEED = /^[A-Z2-7]{16,}=*$/;

function classifySecret(value: string): SecretState {
  if (!value) return "plaintext";
  if (BASE32_SEED.test(value)) return "plaintext";
  // Not the base64 alphabet at all (a Discord token carries '.', '-' or '_'),
  // or too short to hold IV(12) + ciphertext(>=1) + tag(16).
  if (value.length < 28) return "plaintext";
  if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return "plaintext";
  let buf: Buffer;
  try {
    buf = Buffer.from(value, "base64");
  } catch {
    return "plaintext";
  }
  if (buf.length < 29) return "plaintext";
  // Ciphertext-shaped from here on: it either decrypts under the current key
  // or it is something we must not touch.
  try {
    decryptApiKey(value);
    return "encrypted";
  } catch {
    return "unreadable";
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
      const state = classifySecret(v);
      if (state === "encrypted") {
        stats.totpAlreadyEncrypted++;
        continue;
      }
      if (state === "unreadable") {
        stats.totpUnreadable++;
        console.error(
          `[security-migration] totp_secret for user ${row.id} is ciphertext that does not decrypt under the current API_KEY_ENCRYPTION_KEY. Leaving it untouched: re-encrypting it would destroy the seed. Check whether the key was rotated.`,
        );
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
      const accessState = classifySecret(row.access_token);
      const refreshState = classifySecret(row.refresh_token);

      // Same fail-safe as the TOTP loop: if either half is ciphertext we
      // cannot read, skip the whole row rather than re-encrypt it.
      if (accessState === "unreadable" || refreshState === "unreadable") {
        stats.discordUnreadable++;
        console.error(
          `[security-migration] Discord tokens for user ${row.user_id} are ciphertext that does not decrypt under the current API_KEY_ENCRYPTION_KEY. Leaving them untouched. Check whether the key was rotated.`,
        );
        continue;
      }

      const needsAccess = accessState === "plaintext";
      const needsRefresh = refreshState === "plaintext";

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
