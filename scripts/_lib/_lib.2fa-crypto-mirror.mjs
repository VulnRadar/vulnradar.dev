/**
 * VulnRadar — TOTP-secret encryption mirror.
 *
 * Same constraint as _lib.2fa-hash-mirror.mjs: scripts/ is plain .mjs run
 * with plain `node`, so it cannot `import` lib/auth/crypto.ts directly.
 * This module ports decryptApiKey()'s AES-256-GCM framing verbatim
 * (algorithm, IV/tag lengths, base64 layout) so the diagnostic can
 * attempt the exact same decrypt the app would perform.
 *
 * tests/scripts/_lib.2fa-crypto-mirror.test.ts cross-checks this against
 * the real lib/auth/crypto.ts (encrypt with one, decrypt with the other)
 * so drift between the two fails a test instead of going unnoticed.
 */
import { createDecipheriv } from "node:crypto";

// Mirrors lib/auth/crypto.ts's constants.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Mirrors lib/auth/crypto.ts's getEncryptionKey(), but returns null instead of throwing. */
export function getEncryptionKey() {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

export function isEncryptionConfigured() {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  return Boolean(hex) && hex.length === 64;
}

/**
 * Mirrors lib/auth/crypto.ts's decryptApiKey(), taking the key as an
 * explicit Buffer (rather than reading process.env internally) so tests
 * can exercise it against arbitrary keys. Throws on any failure -- bad
 * base64, wrong length, auth-tag mismatch, wrong key -- exactly like the
 * real function. Callers must catch.
 */
export function decryptApiKeyMirror(encryptedBase64, key) {
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
 * A genuine TOTP seed from lib/auth/totp.ts's generateSecret() is always
 * exactly 32 base32 characters (randomBytes(20) -> 160 bits -> 32
 * 5-bit groups, no padding needed).
 *
 * A decrypted value that doesn't match this pattern is concerning in a
 * way a thrown decrypt error is not: it means AES-GCM authentication
 * *succeeded* (the ciphertext, IV, and auth tag were all internally
 * consistent under the current key) but the plaintext isn't a TOTP seed.
 * The most plausible way that happens on this codebase: if
 * API_KEY_ENCRYPTION_KEY was ever rotated, lib/auth/security-migration.ts's
 * migratePlaintextSecretsToEncrypted() -- which runs on every app boot --
 * would find that the OLD ciphertext no longer decrypts under the NEW
 * key, assume (per its own doc comment) that this means the value is
 * legacy plaintext that was never encrypted, and re-encrypt it as-is.
 * The result is a value that decrypts cleanly under the current key into
 * garbage bytes, rather than throwing.
 */
const BASE32_SECRET_PATTERN = /^[A-Z2-7]{32}$/;
export function looksLikeTotpSecret(decrypted) {
  return typeof decrypted === "string" && BASE32_SECRET_PATTERN.test(decrypted);
}
