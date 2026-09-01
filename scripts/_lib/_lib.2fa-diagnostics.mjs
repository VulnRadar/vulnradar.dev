/**
 * VulnRadar — 2FA data-integrity classification.
 *
 * Single source of truth for "what counts as broken 2FA data", shared by
 * both scripts/maintenance/db-diagnose-2fa.mjs (read-only report) and
 * scripts/maintenance/db-repair-2fa.mjs (the opt-in repair). Neither script decides
 * on its own what qualifies as a problem -- they both call the functions
 * here, so the two can never disagree about what "broken" means.
 *
 * Category severities:
 *   "repair-eligible" -- the row is provably broken in a way that can
 *     never self-heal (see each category's comment below) and matches
 *     the one safe repair this tool supports: reset that user's 2FA
 *     state to disabled so they are not permanently locked out.
 *   "warning"          -- worth a human's attention, but the row is not
 *     provably corrupt (or the corruption isn't verifiable, e.g. no
 *     encryption key configured) and is deliberately NOT touched by the
 *     repair script. Resetting a user's 2FA is a real, disruptive
 *     account change; it must only happen when there is no other
 *     option.
 */
import { classifyBackupCodesColumn } from "./_lib.2fa-hash-mirror.mjs";
import {
  getEncryptionKey,
  decryptApiKeyMirror,
  looksLikeTotpSecret,
} from "./_lib.2fa-crypto-mirror.mjs";

export const CATEGORY = {
  BACKUP_CODES_MALFORMED_JSON: "backup_codes_malformed_json",
  BACKUP_CODES_NOT_ARRAY: "backup_codes_not_array",
  BACKUP_CODES_NON_STRING: "backup_codes_non_string_element",
  BACKUP_CODES_BAD_FORMAT: "backup_codes_bad_format",
  BACKUP_CODES_MISSING: "backup_codes_missing",
  TOTP_SECRET_MISSING: "totp_secret_missing",
  TOTP_SECRET_LEGACY_PLAINTEXT: "totp_secret_legacy_plaintext_prefix",
  TOTP_SECRET_DECRYPT_FAILED: "totp_secret_decrypt_failed",
  TOTP_SECRET_DECRYPTS_TO_GARBAGE: "totp_secret_decrypts_to_garbage",
  ENCRYPTION_NOT_CONFIGURED: "encryption_not_configured",
};

/**
 * Categories the repair script is allowed to act on. Every one of these
 * represents data that can never be un-corrupted (a hash format that can
 * never verify, or ciphertext that can never be decrypted back to a real
 * secret) -- resetting 2FA to disabled and forcing re-enrollment is the
 * only way to avoid a permanent account lockout.
 */
export const REPAIR_ELIGIBLE_CATEGORIES = new Set([
  CATEGORY.BACKUP_CODES_MALFORMED_JSON,
  CATEGORY.BACKUP_CODES_NOT_ARRAY,
  CATEGORY.BACKUP_CODES_NON_STRING,
  CATEGORY.TOTP_SECRET_MISSING,
  CATEGORY.TOTP_SECRET_LEGACY_PLAINTEXT,
  CATEGORY.TOTP_SECRET_DECRYPT_FAILED,
  CATEGORY.TOTP_SECRET_DECRYPTS_TO_GARBAGE,
]);

const CATEGORY_LABEL = {
  [CATEGORY.BACKUP_CODES_MALFORMED_JSON]: "backup_codes is not valid JSON",
  [CATEGORY.BACKUP_CODES_NOT_ARRAY]: "backup_codes JSON is not an array",
  [CATEGORY.BACKUP_CODES_NON_STRING]:
    "backup_codes array contains a non-string element",
  [CATEGORY.BACKUP_CODES_BAD_FORMAT]:
    "one or more backup codes have an unrecognized hash format (dead code slot, but the array itself is intact)",
  [CATEGORY.BACKUP_CODES_MISSING]:
    "app-based 2FA is enabled but backup_codes is empty/NULL",
  [CATEGORY.TOTP_SECRET_MISSING]:
    "app-based 2FA is enabled but totp_secret is NULL (permanent lockout: the verify endpoint requires it, and re-enrollment is blocked while totp_enabled is true)",
  [CATEGORY.TOTP_SECRET_LEGACY_PLAINTEXT]:
    "totp_secret has the legacy 'plain:' marker the app already treats as invalid (permanent lockout for the same reason as a missing secret)",
  [CATEGORY.TOTP_SECRET_DECRYPT_FAILED]:
    "totp_secret failed to decrypt with the configured API_KEY_ENCRYPTION_KEY",
  [CATEGORY.TOTP_SECRET_DECRYPTS_TO_GARBAGE]:
    "totp_secret decrypts without error but is not a valid base32 TOTP seed (consistent with double-encryption after an encryption-key rotation)",
  [CATEGORY.ENCRYPTION_NOT_CONFIGURED]:
    "API_KEY_ENCRYPTION_KEY is not configured on this run -- totp_secret could not be checked either way",
};

export function describeCategory(category) {
  return CATEGORY_LABEL[category] || category;
}

/**
 * Classify one row already filtered to totp_enabled = true by the
 * caller's SQL. Never throws -- any unexpected shape is reported as a
 * problem category, not an exception.
 */
export function classifyUser(row) {
  const problems = [];
  const method = row.two_factor_method || "app";

  const bc = classifyBackupCodesColumn(row.backup_codes);
  if (bc.status === "malformed_json") {
    problems.push({
      category: CATEGORY.BACKUP_CODES_MALFORMED_JSON,
      severity: "repair-eligible",
    });
  } else if (bc.status === "not_array") {
    problems.push({
      category: CATEGORY.BACKUP_CODES_NOT_ARRAY,
      severity: "repair-eligible",
    });
  } else if (bc.status === "contains_non_string") {
    problems.push({
      category: CATEGORY.BACKUP_CODES_NON_STRING,
      severity: "repair-eligible",
    });
  } else if (bc.status === "empty" && method === "app") {
    problems.push({
      category: CATEGORY.BACKUP_CODES_MISSING,
      severity: "warning",
    });
  } else if (bc.status === "ok" && bc.badFormatCount > 0) {
    problems.push({
      category: CATEGORY.BACKUP_CODES_BAD_FORMAT,
      severity: "warning",
      detail: `${bc.badFormatCount} of ${bc.total} backup codes`,
    });
  }

  // totp_secret is only meaningful for app-based 2FA. Email-based 2FA
  // never reads it (see app/api/v3/auth/2fa/verify/route.ts), so a
  // leftover/stale value there is not a live lockout risk.
  if (method === "app") {
    if (!row.totp_secret) {
      problems.push({
        category: CATEGORY.TOTP_SECRET_MISSING,
        severity: "repair-eligible",
      });
    } else if (row.totp_secret.startsWith("plain:")) {
      problems.push({
        category: CATEGORY.TOTP_SECRET_LEGACY_PLAINTEXT,
        severity: "repair-eligible",
      });
    } else {
      const key = getEncryptionKey();
      if (!key) {
        problems.push({
          category: CATEGORY.ENCRYPTION_NOT_CONFIGURED,
          severity: "warning",
        });
      } else {
        try {
          const decrypted = decryptApiKeyMirror(row.totp_secret, key);
          if (!looksLikeTotpSecret(decrypted)) {
            problems.push({
              category: CATEGORY.TOTP_SECRET_DECRYPTS_TO_GARBAGE,
              severity: "repair-eligible",
            });
          }
        } catch {
          problems.push({
            category: CATEGORY.TOTP_SECRET_DECRYPT_FAILED,
            severity: "repair-eligible",
          });
        }
      }
    }
  }

  return {
    userId: row.id,
    method,
    problems,
    repairEligible: problems.some((p) => p.severity === "repair-eligible"),
  };
}

/**
 * Hygiene-only classification of an email_2fa_codes row. Never
 * repair-eligible: the repair script's scope is limited to the one safe
 * change (resetting a user's 2FA state), and a stray or expired email
 * code is neither a lockout risk nor unrecoverable data.
 */
export function classifyEmail2FACodeRow(row, { hasCodeSalt = false } = {}) {
  const problems = [];

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    problems.push({
      category: "email_2fa_code_expired_uncleaned",
      severity: "warning",
    });
  }

  if (
    typeof row.code_hash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(row.code_hash)
  ) {
    problems.push({
      category: "email_2fa_code_malformed_hash",
      severity: "warning",
    });
  }

  if (hasCodeSalt && (!row.code_salt || row.code_salt === "0")) {
    problems.push({
      category: "email_2fa_code_unsalted",
      severity: "warning",
    });
  }

  return { id: row.id, userId: row.user_id, problems };
}
