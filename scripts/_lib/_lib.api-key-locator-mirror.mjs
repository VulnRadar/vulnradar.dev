/**
 * VulnRadar — API key locator mirror.
 *
 * Mirrors lib/api/api-keys.ts's computeKeyLocator(): a keyed HMAC-SHA256
 * over the raw API key, truncated to 8 hex chars, used as an indexed
 * lookup column (api_keys.key_locator). It reuses the SAME
 * API_KEY_ENCRYPTION_KEY as the AES-256-GCM encryption
 * (lib/api/api-keys.ts's getLocatorSecret()), so no new secret is needed
 * here beyond what scripts/_lib/_lib.2fa-crypto-mirror.mjs already reads.
 *
 * Why this matters for corruption detection: decrypting
 * api_keys.key_encrypted without an exception proves the AES-GCM auth
 * tag matched, but NOT that the plaintext is the real original key --
 * the exact same "decrypts cleanly to garbage" risk the 2FA tool found
 * for totp_secret after a key rotation (see
 * lib/auth/security-migration.ts). For an API key we have a second,
 * independent way to check: recompute the locator from the decrypted
 * plaintext and compare it to the stored key_locator. A mismatch proves
 * the decrypted value isn't the key this row claims to hold.
 *
 * tests/scripts/_lib.api-key-locator-mirror.test.ts cross-checks this
 * against a re-implementation using the exact same algorithm description
 * lib/api/api-keys.ts documents (HMAC-SHA256, first 8 hex chars) so a
 * change to that algorithm doesn't silently desync this mirror.
 */
import { createHmac } from "node:crypto";

export function computeApiKeyLocatorMirror(rawKey, key) {
  return createHmac("sha256", key).update(rawKey).digest("hex").slice(0, 8);
}
