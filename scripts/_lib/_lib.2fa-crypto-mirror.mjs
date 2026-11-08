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

/**
 * The one shape every AES-256 key in these scripts has to have.
 *
 * The length alone is not enough: Buffer.from(value, "hex") stops at the first
 * pair that is not hex and returns whatever it had, so a 64-character value
 * with a stray "g" in it became a short key, every decrypt threw, and the
 * repair tools read that as every row in the database being corrupt.
 */
export function isValidKeyHex(hex) {
  return typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex);
}

/** Mirrors lib/auth/crypto.ts's getEncryptionKey(), but returns null instead of throwing. */
export function getEncryptionKey() {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  return isValidKeyHex(hex) ? Buffer.from(hex, "hex") : null;
}

export function isEncryptionConfigured() {
  return isValidKeyHex(process.env.API_KEY_ENCRYPTION_KEY);
}

/** Mirrors lib/auth/crypto.ts's getPreviousEncryptionKey(). */
export function getPreviousEncryptionKey() {
  const hex = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  return isValidKeyHex(hex) ? Buffer.from(hex, "hex") : null;
}

/**
 * True when the operator set PREVIOUS_API_KEY_ENCRYPTION_KEY to something that
 * cannot be a key. A rotation is in progress and the old key is out of reach,
 * so a value that fails to decrypt proves nothing. The app logs this and
 * carries on; a tool about to delete data has to stop calling rows broken.
 */
export function isPreviousKeyUnusable() {
  const hex = process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  return Boolean(hex) && !isValidKeyHex(hex);
}

/**
 * The keys a stored value may be under, in the order the app tries them.
 * A previous key equal to the current one is left out: it would only report
 * rows on the current key as still needing to move.
 */
export function getKnownKeys() {
  const current = getEncryptionKey();
  const previous = getPreviousEncryptionKey();
  return {
    current,
    previous: previous && current?.equals(previous) ? null : previous,
  };
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
 * Try the current key, then the previous one, the way decryptApiKey() does.
 *
 * GCM is what makes this unambiguous: a wrong key fails the auth tag instead
 * of returning wrong plaintext, so a value opening under the previous key
 * really is on the previous key.
 *
 * `isGenuine` is the extra check a column can apply to the plaintext. Failing
 * it under one key does not stop the other from being tried.
 *
 * @param {string} value the stored base64 ciphertext
 * @param {{ current: Buffer | null, previous: Buffer | null }} keys
 * @param {(plaintext: string) => boolean} [isGenuine]
 * @returns {{ status: "current" | "previous" | "garbage" | "failed", plaintext?: string }}
 *   "garbage": a key opened it, but what came out is not a real value
 *   "failed": no key opened it
 */
export function openWithKnownKeys(value, keys, isGenuine = () => true) {
  let status = "failed";
  for (const name of ["current", "previous"]) {
    if (!keys[name]) continue;
    let plaintext;
    try {
      plaintext = decryptApiKeyMirror(value, keys[name]);
    } catch {
      continue;
    }
    if (isGenuine(plaintext)) return { status: name, plaintext };
    status = "garbage";
  }
  return { status };
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
