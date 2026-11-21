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
 *
 * A key that is set but malformed is not that case. isEncryptionConfigured()
 * is false for it as well, and treating it the same would write a secret in
 * the clear on a deployment whose operator believes it is encrypting, so
 * encryptApiKey is left to refuse it.
 */
export function encryptWebhookSecret(plaintext: string): string {
  return process.env.API_KEY_ENCRYPTION_KEY
    ? encryptApiKey(plaintext)
    : plaintext;
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

/**
 * webhooks.url at rest (enc-2).
 *
 * A Discord or Slack webhook URL carries its token in the path: whoever holds
 * the URL can post into that channel. So the address is held like the signing
 * secret beside it, in url_encrypted, with url left as '' (the column stays
 * NOT NULL, so no constraint changes at boot) and the host in url_host for the
 * places that only identify the service.
 *
 * The same key rule as encryptWebhookSecret: no key at all keeps the address
 * in url, and a key that is set but malformed is left to encryptApiKey to
 * refuse rather than silently writing the credential in the clear.
 */
export function encryptWebhookUrl(url: string): string | null {
  return process.env.API_KEY_ENCRYPTION_KEY ? encryptApiKey(url) : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

export interface StoredWebhookUrl {
  url: string;
  urlEncrypted: string | null;
  urlHost: string | null;
}

/**
 * The three column values a writer stores for an address, always all three
 * together. url_encrypted is null when there is no key, and the writer sets
 * it anyway, so no ciphertext of an older address is left in the row.
 */
export function storeWebhookUrl(url: string): StoredWebhookUrl {
  const urlEncrypted = encryptWebhookUrl(url);
  return { url: urlEncrypted ? "" : url, urlEncrypted, urlHost: hostOf(url) };
}

/**
 * The address of a stored webhook row: the url column when it holds one, and
 * otherwise url_encrypted opened under the current key, then the previous one
 * (decryptApiKey tries both).
 *
 * A non-empty url wins over url_encrypted because this code never writes both:
 * storeWebhookUrl and the boot migration empty url whenever they store
 * ciphertext. A row that has both was edited after it was encrypted by
 * something that knows only the url column (a 3.9.1 binary during a rollback
 * or a rolling deploy, or a hand edit), so the url column is the newer
 * address, and the boot migration encrypts it on the next start.
 *
 * Returns null for ciphertext that does not open, so the caller sends nothing
 * rather than posting somewhere it cannot name. The log carries the row id so
 * an operator can find it, and never the stored value.
 */
export function readWebhookUrl(row: {
  id?: number | null;
  url?: string | null;
  url_encrypted?: string | null;
}): string | null {
  if (row.url) return row.url;
  if (!row.url_encrypted) return null;
  try {
    return decryptApiKey(row.url_encrypted);
  } catch {
    console.error(
      `[${APP_NAME}] The address of webhook ${row.id ?? "(unknown)"} is ciphertext that does not decrypt under API_KEY_ENCRYPTION_KEY or PREVIOUS_API_KEY_ENCRYPTION_KEY. Nothing is sent to it until it is saved again.`,
    );
    return null;
  }
}

/**
 * The host a row identifies its service by, for a row written either way.
 * Read from a non-empty url first, for the reason readWebhookUrl gives.
 */
export function readWebhookHost(row: {
  url?: string | null;
  url_host?: string | null;
}): string | null {
  return (row.url ? hostOf(row.url) : null) ?? (row.url_host || null);
}

export interface WebhookSecretMigrationStats {
  scanned: number;
  encrypted: number;
  alreadyEncrypted: number;
  unreadable: number;
  urlsEncrypted: number;
}

/**
 * Backfill: encrypt every plaintext webhooks.secret in place. Idempotent, so
 * instrumentation.ts can call it on every boot; a row that is already
 * ciphertext is counted and skipped, and one that is ciphertext-shaped but
 * unreadable is left strictly alone.
 *
 * It then moves every plaintext webhooks.url into url_encrypted and url_host
 * (enc-2), which is idempotent the same way: a moved row has url '' and no
 * longer matches. Every non-empty url is moved, including one beside an
 * existing ciphertext: that url was written after the ciphertext (see
 * readWebhookUrl), so it replaces it rather than staying in the clear.
 */
export async function migratePlaintextWebhookSecrets(): Promise<WebhookSecretMigrationStats> {
  const stats: WebhookSecretMigrationStats = {
    scanned: 0,
    encrypted: 0,
    alreadyEncrypted: 0,
    unreadable: 0,
    urlsEncrypted: 0,
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

  const urlRows = await pool.query<{ id: number; url: string }>(
    "SELECT id, url FROM webhooks WHERE url <> ''",
  );
  for (const row of urlRows.rows) {
    try {
      // Guarded on the value read above: an edit saved between that read and
      // this write already stored its own address, and this must not replace
      // it with the older one.
      const result = await pool.query(
        `UPDATE webhooks SET url_encrypted = $2, url_host = $3, url = ''
          WHERE id = $1 AND url = $4`,
        [row.id, encryptApiKey(row.url), hostOf(row.url), row.url],
      );
      if (result.rowCount === 1) stats.urlsEncrypted++;
    } catch (err) {
      console.error(
        `[${APP_NAME}] Failed to encrypt webhooks.url for webhook ${row.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return stats;
}
