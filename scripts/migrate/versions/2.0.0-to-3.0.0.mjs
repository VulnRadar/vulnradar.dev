/**
 * v2.0.0 → v3.0.0 — AI chat, email preferences, security hardening.
 *
 * What this upgrade adds:
 *   - `ai_conversations` table: stores every AI chat session keyed by a
 *     client-generated UUID (session_id). One row per conversation; the
 *     widget upserts on session_id. user_id is nullable so guest sessions
 *     are tracked too.
 *   - `browser_sessions` table: maps BrowserBase session IDs to the
 *     user who created them, enabling ownership checks on GET/DELETE
 *     (AUDIT-004#idor-01).
 *   - `users.unsubscribe_token` UUID (DEFAULT gen_random_uuid()): a
 *     per-user token embedded in email footers so recipients can manage
 *     preferences without logging in.
 *   - `users.email_prefs` JSONB: per-user toggles for five email
 *     categories (security, account_changes, api_webhooks, teams,
 *     general). Defaults to all-on.
 *   - `users.totp_last_counter` BIGINT: last accepted TOTP time-step
 *     counter, preventing code replay within the same 30-second window
 *     (AUDIT-004#auth-01).
 *   - `scan_history.share_token_hash` TEXT GENERATED ALWAYS: SHA-256
 *     hex of share_token, auto-computed and back-filled by Postgres.
 *     Share and badge routes look up by hash instead of plaintext
 *     (AUDIT-004#secrets-01).
 *   - `billing_verification_codes.salt` TEXT: per-code random salt for
 *     salted hashing of verification codes (AUDIT-004#secrets-02).
 *
 * Reversible: see the `downgrade` export. Downgrading DROPs ai_conversations
 * and browser_sessions (losing all data) and DROPs the added columns.
 */

import { V3_NEW_TABLES } from "./_snippets.mjs";

export const from = "2.0.0";
export const to = "3.0.0";

export const upgrade = {
  description:
    "Add ai_conversations + browser_sessions tables; unsubscribe_token, " +
    "email_prefs, totp_last_counter columns on users; share_token_hash " +
    "generated column on scan_history; salt column on billing_verification_codes.",

  addTables: [
    { name: "ai_conversations", sql: V3_NEW_TABLES.ai_conversations },
    { name: "browser_sessions", sql: V3_NEW_TABLES.browser_sessions },
  ],

  addIndexes: [
    {
      name: "idx_ai_conversations_user_id",
      table: "ai_conversations",
      columns: "user_id",
    },
    {
      name: "idx_ai_conversations_created_at",
      table: "ai_conversations",
      columns: "created_at DESC",
    },
    {
      name: "idx_ai_conversations_session_id",
      table: "ai_conversations",
      columns: "session_id",
    },
    {
      name: "idx_browser_sessions_user_id",
      table: "browser_sessions",
      columns: "user_id",
    },
    {
      name: "idx_scan_history_share_token_hash",
      table: "scan_history",
      columns: "share_token_hash",
      where: "share_token_hash IS NOT NULL",
    },
  ],

  addColumns: [
    {
      table: "users",
      column: "unsubscribe_token",
      definition: "UUID DEFAULT gen_random_uuid()",
    },
    {
      table: "users",
      column: "email_prefs",
      // JSONB with NOT NULL requires a DEFAULT so existing rows get
      // the all-enabled preference set automatically.
      definition:
        'JSONB NOT NULL DEFAULT \'{"security":true,"account_changes":true,"api_webhooks":true,"teams":true,"general":true}\'',
    },
    {
      table: "users",
      column: "totp_last_counter",
      definition: "BIGINT",
    },
    {
      table: "scan_history",
      column: "share_token_hash",
      // Stored generated column — Postgres computes and persists the
      // SHA-256 hex of share_token for every row (including existing
      // rows, which are back-filled automatically on ALTER TABLE).
      // sha256(bytea) is available without pgcrypto in PG 11+.
      definition:
        "TEXT GENERATED ALWAYS AS (encode(sha256(share_token::bytea), 'hex')) STORED",
    },
    {
      table: "billing_verification_codes",
      column: "salt",
      definition: "TEXT",
    },
  ],
};

export const downgrade = {
  description:
    "Drop ai_conversations + browser_sessions tables and all v3 columns. " +
    "DELETES all AI chat history, browser session ownership records, and " +
    "email preferences.",

  dropTables: ["ai_conversations", "browser_sessions"],

  dropColumns: [
    { table: "users", column: "unsubscribe_token" },
    { table: "users", column: "email_prefs" },
    { table: "users", column: "totp_last_counter" },
    { table: "scan_history", column: "share_token_hash" },
    { table: "billing_verification_codes", column: "salt" },
  ],
};
