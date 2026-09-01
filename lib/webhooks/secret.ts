/**
 * webhooks.secret at rest (AUDIT-009#webhook-01).
 *
 * The HMAC signing secret was the one long-lived reversible secret in the
 * app stored as plain TEXT. Every other one (API keys, TOTP seeds, Discord
 * and GitHub OAuth tokens, user AI provider keys) goes through
 * lib/auth/crypto.ts's AES-256-GCM pipeline, so a database-level compromise
 * that leaked nothing else still handed an attacker every user's webhook
 * secret, which is enough to forge validly-signed payloads to their
 * receivers.
 *
 * Three-state classification, not two, for exactly the reason
 * lib/auth/security-migration.ts documents: a value that is ciphertext but
 * does not decrypt (a rotated key, an .env copied between environments) must
 * never be treated as legacy plaintext, or the backfill re-encrypts it and
 * destroys the original. Here that state means "do not sign with this",
 * which is a loud no-op rather than a silently wrong signature.
 */
import pool from "@/lib/database/db";
import {
  decryptApiKey,
  encryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";
import { APP_NAME } from "@/lib/config/constants";

/**
 * What POST /api/v3/webhooks and the rotate-secret route generate: 32 random
 * bytes, hex-encoded. Checked before the ciphertext shape below because 64
 * hex characters are also a valid base64 string that decodes to 48 bytes,
 * so a real legacy secret would otherwise be misread as ciphertext and
 * dropped. Same trap BASE32_SEED avoids for TOTP seeds in
 * lib/auth/security-migration.ts.
 */
const PLAINTEXT_SECRET = /^[0-9a-f]{64}$/;

/** iv(12) + at least one ciphertext byte + tag(16), base64-encoded. */
function looksLikeCiphertext(value: string): boolean {
  if (value.length < 28) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").length >= 29;
  } catch {
    return false;
  }
}

/**
 * Encrypt a freshly generated secret for storage. Falls back to storing the
 * plaintext when no API_KEY_ENCRYPTION_KEY is configured, matching
 * lib/api/api-keys.ts: a self-hoster who has not set the key keeps a working
 * deployment, and readWebhookSecret below reads either form.
 */
export function encryptWebhookSecret(plaintext: string): string {
  return isEncryptionConfigured() ? encryptApiKey(plaintext) : plaintext;
}

/**
 * The raw signing secret for a stored `webhooks.secret` value, whatever form
 * that row is in: current ciphertext, a legacy plaintext row the backfill has
 * not reached yet, or one written by a direct database insert.
 *
 * Returns null for a value that is ciphertext-shaped but does not decrypt.
 * Signing with the ciphertext itself would produce a signature no receiver
 * can verify while looking like everything worked, so the delivery goes out
 * unsigned and the reason is logged.
 */
export function readWebhookSecret(
  stored: string | null | undefined,
): string | null {
  if (!stored) return null;
  if (PLAINTEXT_SECRET.test(stored)) return stored;
  if (!looksLikeCiphertext(stored)) return stored;
  try {
    return decryptApiKey(stored);
  } catch {
    console.error(
      `[${APP_NAME}] A webhook secret is ciphertext that does not decrypt under the current API_KEY_ENCRYPTION_KEY. Delivering unsigned. Check whether the key was rotated (PREVIOUS_API_KEY_ENCRYPTION_KEY covers a rotation).`,
    );
    return null;
  }
}

export interface WebhookSecretMigrationStats {
  scanned: number;
  encrypted: number;
  alreadyEncrypted: number;
  unreadable: number;
}

/**
 * Backfill: encrypt every plaintext webhooks.secret in place. Idempotent, so
 * instrumentation.ts can call it on every boot; a row that is already
 * ciphertext is counted and skipped, and one that is ciphertext-shaped but
 * unreadable is left strictly alone.
 */
export async function migratePlaintextWebhookSecrets(): Promise<WebhookSecretMigrationStats> {
  const stats: WebhookSecretMigrationStats = {
    scanned: 0,
    encrypted: 0,
    alreadyEncrypted: 0,
    unreadable: 0,
  };
  if (!isEncryptionConfigured()) return stats;

  const { rows } = await pool.query<{ id: number; secret: string | null }>(
    "SELECT id, secret FROM webhooks WHERE secret IS NOT NULL",
  );
  stats.scanned = rows.length;

  for (const row of rows) {
    const value = row.secret;
    if (!value) continue;
    if (!PLAINTEXT_SECRET.test(value) && looksLikeCiphertext(value)) {
      try {
        decryptApiKey(value);
        stats.alreadyEncrypted++;
      } catch {
        stats.unreadable++;
        console.error(
          `[${APP_NAME}] webhooks.secret for webhook ${row.id} is ciphertext that does not decrypt under the current API_KEY_ENCRYPTION_KEY. Leaving it untouched: re-encrypting it would destroy the secret.`,
        );
      }
      continue;
    }
    try {
      await pool.query("UPDATE webhooks SET secret = $1 WHERE id = $2", [
        encryptApiKey(value),
        row.id,
      ]);
      stats.encrypted++;
    } catch (err) {
      stats.unreadable++;
      console.error(
        `[${APP_NAME}] Failed to encrypt webhooks.secret for webhook ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}
