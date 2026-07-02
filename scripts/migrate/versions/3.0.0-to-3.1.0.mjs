/**
 * v3.0.0 → v3.1.0 — AUDIT-004 security hardening.
 *
 * What this upgrade adds:
 *   - `users.totp_last_counter` BIGINT: tracks the last TOTP time-step
 *     that was accepted for this account, preventing code replay within
 *     the same 30-second window (AUDIT-004#auth-01).
 *
 *   - `scan_history.share_token_hash` TEXT GENERATED: a SHA-256 hex hash
 *     of share_token, stored as a PostgreSQL GENERATED ALWAYS column.
 *     Existing rows are back-filled automatically by Postgres. Public share
 *     and badge routes look up by hash so the plaintext token is never
 *     compared directly (AUDIT-004#secrets-01).
 *
 *   - `billing_verification_codes.salt` TEXT: per-code random salt so
 *     codes are stored as salted hashes rather than plaintext
 *     (AUDIT-004#secrets-02). Application code writes the salt at issue
 *     time; the column is NULL for legacy codes until they expire.
 *
 * Reversible: see the `downgrade` export. Dropping share_token_hash also
 * drops its partial index. The totp_last_counter drop is safe (NULL on
 * re-add) but TOTP replay protection will be lost until re-migrated.
 */

export const from = "3.0.0";
export const to = "3.1.0";

export const upgrade = {
  description:
    "AUDIT-004: TOTP replay counter + share-token SHA-256 hash + billing code salt.",

  addColumns: [
    {
      table: "users",
      column: "totp_last_counter",
      definition: "BIGINT",
    },
    {
      table: "scan_history",
      column: "share_token_hash",
      // Stored generated column: Postgres computes and persists this
      // automatically. sha256() is available without pgcrypto in PG 11+.
      // Existing rows are back-filled when the column is added.
      definition:
        "TEXT GENERATED ALWAYS AS (encode(sha256(share_token::bytea), 'hex')) STORED",
    },
    {
      table: "billing_verification_codes",
      column: "salt",
      definition: "TEXT",
    },
  ],

  addIndexes: [
    {
      name: "idx_scan_history_share_token_hash",
      table: "scan_history",
      columns: "share_token_hash",
      where: "share_token_hash IS NOT NULL",
    },
  ],
};

export const downgrade = {
  description:
    "Drop TOTP last-counter, share-token hash column + index, and billing code salt.",

  dropColumns: [
    { table: "users", column: "totp_last_counter" },
    { table: "scan_history", column: "share_token_hash" },
    { table: "billing_verification_codes", column: "salt" },
  ],
};
