import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Get the AES-256 encryption key from environment.
 * Must be a 64-char hex string (32 bytes).
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function getEncryptionKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * The key a previous deployment used, kept readable during a rotation.
 *
 * One key protects TOTP seeds, Discord and GitHub OAuth tokens, user AI
 * provider keys and API keys, and rotating it used to be impossible without
 * hand-editing the database: every existing ciphertext became garbage the
 * moment the environment variable changed, and there was no second key to
 * fall back to (AUDIT-007#auth-02).
 *
 * GCM is what makes the fallback safe and unambiguous. The auth tag means a
 * decrypt under the wrong key fails rather than returning wrong plaintext,
 * so "try the current key, then the previous one" cannot silently mis-decode
 * a value, and no key_version column or migration script is needed to tell
 * the two apart. Writes always use the CURRENT key, so every value that gets
 * rewritten for any other reason (a rotated API key, a re-linked OAuth
 * account, a re-enrolled TOTP seed) migrates itself.
 *
 * Operator procedure: set PREVIOUS_API_KEY_ENCRYPTION_KEY to the old value,
 * set API_KEY_ENCRYPTION_KEY to the new one, restart. Remove the previous
 * key once everything has been rewritten under the new one.
 */
function getPreviousEncryptionKey(): Buffer | null {
  const hex = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    // Loud but non-fatal: an operator mid-rotation has explicitly set this,
    // so staying silent would present as "some accounts mysteriously cannot
    // log in". Throwing instead would be swallowed by the callers that treat
    // a decrypt failure as "wrong key" (lib/api/api-keys.ts), which is worse.
    console.error(
      "[crypto] PREVIOUS_API_KEY_ENCRYPTION_KEY is set but is not a 64-character hex string; ignoring it. Values encrypted with the old key will not decrypt.",
    );
    return null;
  }
  return Buffer.from(hex, "hex");
}

function decryptWith(key: Buffer, encryptedBase64: string): string {
  const combined = Buffer.from(encryptedBase64, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(combined.length - TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a combined string: base64(iv + ciphertext + authTag)
 */
export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Combine: iv (12) + encrypted (variable) + tag (16)
  const combined = Buffer.concat([iv, encrypted, tag]);
  return combined.toString("base64");
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Expects the format from encryptApiKey: base64(iv + ciphertext + authTag)
 *
 * Falls back to PREVIOUS_API_KEY_ENCRYPTION_KEY when the current key does
 * not authenticate the ciphertext, so a key rotation does not orphan
 * everything already encrypted. Throws when neither key works, exactly as
 * before, so every caller's existing "this is not valid ciphertext"
 * handling is unchanged.
 */
export function decryptApiKey(encryptedBase64: string): string {
  return decryptApiKeyWithKeyAge(encryptedBase64).plaintext;
}

/**
 * decryptApiKey, plus which key actually opened the value.
 *
 * `usedPreviousKey` is the signal a lazy re-encryption pass needs: a caller
 * that already has the row in hand can write `encryptApiKey(plaintext)` back
 * when it is true, and the value is then migrated to the current key without
 * any bulk migration script. Nothing is forced to do that; the fallback
 * above keeps everything working either way.
 */
export function decryptApiKeyWithKeyAge(encryptedBase64: string): {
  plaintext: string;
  usedPreviousKey: boolean;
} {
  try {
    return {
      plaintext: decryptWith(getEncryptionKey(), encryptedBase64),
      usedPreviousKey: false,
    };
  } catch (err) {
    const previous = getPreviousEncryptionKey();
    // Rethrow the ORIGINAL error when there is no previous key, so the
    // message a caller sees is still the current key's failure rather than a
    // confusing one about a key that is not configured.
    if (!previous) throw err;
    return {
      plaintext: decryptWith(previous, encryptedBase64),
      usedPreviousKey: true,
    };
  }
}

/**
 * Check if an encryption key is configured.
 * Returns false if not set, allowing graceful fallback.
 */
export function isEncryptionConfigured(): boolean {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  return !!hex && hex.length === 64;
}
