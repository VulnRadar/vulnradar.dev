/**
 * VulnRadar — Backup-code hash format mirror.
 *
 * scripts/ is plain ESM .mjs (see scripts/README.md); there is no
 * ts-node/tsx registered, so a script run via plain `node` cannot
 * `import` lib/auth/password-hash.ts directly. This module ports ONLY
 * the structural, non-cryptographic part of verifyPassword()'s parsing
 * -- the part that decides whether a stored string even has a
 * recognizable shape -- so a read-only diagnostic can flag rows that
 * would break the real code path without needing a plaintext password
 * to actually run scrypt against.
 *
 * We deliberately do NOT call the real scrypt primitive here: a
 * diagnostic has no plaintext backup code to verify against, so a real
 * scrypt call (~650ms, ~128MB) could only ever resolve to `false` --
 * running it 8x per 2FA-enabled user would be slow and prove nothing
 * beyond what the structural check below already tells us.
 *
 * Every constant and branch below is a deliberate 1:1 copy of
 * lib/auth/password-hash.ts's verifyPassword(). SCRYPT_MAX_N/R/P are not
 * exported by that module (they're an internal guard rail), so they are
 * duplicated here by value. tests/scripts/_lib.2fa-hash-mirror.test.ts
 * cross-checks this module's classification against the REAL
 * verifyPassword()'s behavior (imported from @/lib/auth/password-hash,
 * which vitest can resolve) across the same malformed-record battery
 * used by tests/lib/auth/password-hash.test.ts, so any future drift
 * between the two fails a test instead of silently going stale.
 */

// Mirrors lib/auth/password-hash.ts's SCRYPT_KEYLEN.
export const SCRYPT_KEYLEN = 64;

// Mirrors lib/auth/password-hash.ts's internal (non-exported) guard rail
// constants used by paramsInRange().
const SCRYPT_MAX_N = 1 << 20;
const SCRYPT_MAX_R = 32;
const SCRYPT_MAX_P = 16;

/** Mirrors lib/auth/password-hash.ts's paramsInRange(). */
export function paramsInRange(n, r, p) {
  return (
    Number.isInteger(n) &&
    n >= 2 &&
    (n & (n - 1)) === 0 && // scrypt requires N to be a power of two
    n <= SCRYPT_MAX_N &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= SCRYPT_MAX_R &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= SCRYPT_MAX_P
  );
}

/**
 * Structural check mirroring the parsing branch of verifyPassword(),
 * stopping short of calling scrypt. Returns true when `stored` has a
 * shape verifyPassword could actually evaluate (modern 5-part
 * "N:r:p:salt:hash" or legacy 2-part "salt:hash"), false when it is not
 * even a plausible hash record (and would therefore never verify against
 * any password, correct or not).
 */
export function looksLikeValidHashRecord(stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split(":");

  if (parts.length !== 5) {
    const [salt, hash] = parts;
    if (!salt || !hash) return false;
    const hashBuffer = Buffer.from(hash, "hex");
    return hashBuffer.length === SCRYPT_KEYLEN;
  }

  const [nStr, rStr, pStr, salt, hash] = parts;
  const n = Number.parseInt(nStr, 10);
  const r = Number.parseInt(rStr, 10);
  const p = Number.parseInt(pStr, 10);
  if (!paramsInRange(n, r, p)) return false;
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, "hex");
  return hashBuffer.length === SCRYPT_KEYLEN;
}

/**
 * Classify the raw `backup_codes` column value for one user.
 *
 * status:
 *   "empty"               -- NULL/undefined column (nothing to check)
 *   "malformed_json"      -- not valid JSON (or not a string at all)
 *   "not_array"           -- valid JSON, but not an array
 *   "contains_non_string" -- array, but at least one element isn't a
 *                            string (verifyPassword's own `.split(":")`
 *                            would throw a TypeError on such an element)
 *   "ok"                  -- a JSON array of strings
 *
 * badFormatCount (only meaningful when status === "ok"): how many of the
 * string elements don't match any recognizable hash shape. These codes
 * are permanently dead (can never verify against any password) but are
 * not a crash risk and don't corrupt the array itself, so they are
 * reported as a warning, not folded into "malformed".
 */
export function classifyBackupCodesColumn(raw) {
  if (raw === null || raw === undefined) {
    return { status: "empty", total: 0, badFormatCount: 0 };
  }
  if (typeof raw !== "string") {
    return { status: "malformed_json", total: 0, badFormatCount: 0 };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed_json", total: 0, badFormatCount: 0 };
  }

  if (!Array.isArray(parsed)) {
    return { status: "not_array", total: 0, badFormatCount: 0 };
  }

  const nonStringCount = parsed.filter(
    (entry) => typeof entry !== "string",
  ).length;
  if (nonStringCount > 0) {
    return {
      status: "contains_non_string",
      total: parsed.length,
      badFormatCount: nonStringCount,
    };
  }

  const badFormatCount = parsed.filter(
    (entry) => !looksLikeValidHashRecord(entry),
  ).length;
  return { status: "ok", total: parsed.length, badFormatCount };
}
