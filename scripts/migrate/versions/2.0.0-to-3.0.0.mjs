/**
 * v2.0.0 → v3.0.0 — Squashed migration (production schema).
 *
 * This file used to be "v2.0.0 → v3.0.0 (AI chat + security hardening)"
 * only. It now carries the NET effect of an entire unreleased development
 * tail that used to be numbered 3.0.0 through 5.9.0 as separate schema
 * versions. None of those versions ever reached production (the live
 * database has never gone past v2.3.2), so there is no reason for a
 * production upgrade path to walk through nine intermediate schema
 * bumps — it goes straight from the real v2.0.0 production shape to the
 * final v3.0.0 shape in one step. Going forward, schema version tracks
 * the app's major version (no more "5.9.0 schema for a 3.0.0 app").
 *
 * What this upgrade adds, combining what were previously separately
 * numbered versions:
 *   - AI chat: `ai_conversations` (was v3.0.0).
 *   - Browser session ownership: `browser_sessions` (was v3.0.0).
 *   - Security hardening: `users.unsubscribe_token`,
 *     `users.totp_last_counter`, `scan_history.share_token_hash`
 *     (generated column), `billing_verification_codes.salt` (was v3.0.0).
 *   - Scanner learning: `scan_finding_feedback` for false-positive
 *     tracking (was v4.0.0).
 *   - Background scan jobs: `scan_history.status` /
 *     `current_category` / `categories_completed` / `categories_total` /
 *     `started_at` / `error_message` / `result_meta` so a scan can run as
 *     a pollable, cancellable job (was v5.2.0).
 *   - Authenticated scanning: `scan_history.authenticated` (was v5.0.0).
 *     NOTE: the v5.0.0-era `scan_credentials` credential vault and
 *     `scan_history.credential_id` are intentionally NOT part of this
 *     upgrade — that table was added and then fully removed later in the
 *     same unreleased tail (v5.5.0) in favor of fully ephemeral
 *     authenticated scanning (login material is used in-memory for one
 *     request and never persisted; see lib/scanner/auth/). Production
 *     never had the vault, so this migration never creates it.
 *   - IP binding: `api_keys.bound_ip` (was v5.4.0).
 *   - super_admin role tier: idempotent data backfill designating the
 *     earliest-created user (MIN(id)) as `super_admin` (was v5.6.0).
 *   - Host reputation cache: `host_reputation`, keyed by host with no
 *     user_id, for the browser extension's popup (was v5.7.0).
 *   - OAuth signup/login: `users.auth_provider` and a nullable
 *     `users.password_hash`, backfilled to 'password' for every existing
 *     row (was v5.8.0).
 *   - GitHub repo connection + AI code review: `github_connections`,
 *     `github_review_usage`, and `scan_history.scan_type` (was v5.9.0).
 *
 * Performance indexes added along the way (composite indexes for
 * dashboard history, API-key rate limiting, and the admin activity
 * panel; was v5.1.0) are folded into `addIndexes` below.
 *
 * Reversible: see the `downgrade` export.
 */

import { V3_NEW_TABLES } from "./_snippets.mjs";

export const from = "2.0.0";
export const to = "3.0.0";

const SCAN_FINDING_FEEDBACK_SQL = `
  CREATE TABLE IF NOT EXISTS scan_finding_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scan_history_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL,
    finding_id TEXT NOT NULL,
    finding_url TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'false_positive', 'not_applicable')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_finding_feedback_unique
    ON scan_finding_feedback (user_id, finding_id, finding_url);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_finding_id
    ON scan_finding_feedback (finding_id, verdict);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_user
    ON scan_finding_feedback (user_id, created_at DESC);
`;

const USER_NOTIFICATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS user_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_label VARCHAR(100),
    action_url VARCHAR(500),
    related_type VARCHAR(30),
    related_id INTEGER,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const HOST_REPUTATION_SQL = `
  CREATE TABLE IF NOT EXISTS host_reputation (
    host VARCHAR(255) PRIMARY KEY,
    danger_score INTEGER NOT NULL,
    severity_counts JSONB NOT NULL DEFAULT '{}',
    last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_scan_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL
  );
`;

const GITHUB_CONNECTIONS_SQL = `
  CREATE TABLE IF NOT EXISTS github_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    github_user_id BIGINT NOT NULL,
    github_username VARCHAR(255) NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    scopes VARCHAR(255) NOT NULL DEFAULT '',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const GITHUB_REVIEW_USAGE_SQL = `
  CREATE TABLE IF NOT EXISTS github_review_usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year_month VARCHAR(7) NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, year_month)
  );
`;

const ASSIGN_SUPER_ADMIN_SQL = `
  UPDATE users
  SET role = 'super_admin'
  WHERE id = (SELECT MIN(id) FROM users)
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin');
`;

const REVERT_SUPER_ADMIN_SQL = `
  UPDATE users
  SET role = 'admin'
  WHERE role = 'super_admin';
`;

export const upgrade = {
  description:
    "Squashed v2.0.0 -> v3.0.0: ai_conversations, browser_sessions, " +
    "scan_finding_feedback, user_notifications, host_reputation, " +
    "github_connections, github_review_usage tables; unsubscribe_token, " +
    "totp_last_counter, auth_provider on users; share_token_hash, " +
    "authenticated, status, current_category, categories_completed, " +
    "categories_total, started_at, error_message, result_meta, scan_type " +
    "on scan_history; salt on billing_verification_codes; bound_ip on " +
    "api_keys; plus the super_admin backfill and the nullable-password " +
    "OAuth data migration. Does NOT create scan_credentials: that table " +
    "was added and removed within this same unreleased tail (ephemeral " +
    "authenticated scanning replaced it), so production never sees it.",

  addTables: [
    { name: "ai_conversations", sql: V3_NEW_TABLES.ai_conversations },
    { name: "browser_sessions", sql: V3_NEW_TABLES.browser_sessions },
    { name: "scan_finding_feedback", sql: SCAN_FINDING_FEEDBACK_SQL },
    { name: "user_notifications", sql: USER_NOTIFICATIONS_SQL },
    { name: "host_reputation", sql: HOST_REPUTATION_SQL },
    { name: "github_connections", sql: GITHUB_CONNECTIONS_SQL },
    { name: "github_review_usage", sql: GITHUB_REVIEW_USAGE_SQL },
  ],

  addColumns: [
    {
      table: "users",
      column: "unsubscribe_token",
      definition: "UUID DEFAULT gen_random_uuid()",
    },
    {
      table: "users",
      column: "totp_last_counter",
      definition: "BIGINT",
    },
    {
      table: "users",
      column: "auth_provider",
      definition: "VARCHAR(20)",
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
      table: "scan_history",
      column: "authenticated",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "scan_history",
      column: "status",
      definition:
        "VARCHAR(20) NOT NULL DEFAULT 'completed' " +
        "CHECK (status IN ('pending', 'running', 'completed', 'failed'))",
    },
    {
      table: "scan_history",
      column: "current_category",
      definition: "VARCHAR(30)",
    },
    {
      table: "scan_history",
      column: "categories_completed",
      definition: "INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "scan_history",
      column: "categories_total",
      definition: "INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "scan_history",
      column: "started_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "scan_history",
      column: "error_message",
      definition: "TEXT",
    },
    {
      table: "scan_history",
      column: "result_meta",
      definition: "JSONB",
    },
    {
      table: "scan_history",
      column: "scan_type",
      definition: "VARCHAR(20) NOT NULL DEFAULT 'web'",
    },
    {
      table: "billing_verification_codes",
      column: "salt",
      definition: "TEXT",
    },
    {
      table: "api_keys",
      column: "bound_ip",
      definition: "VARCHAR(45)",
    },
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
    {
      name: "idx_scan_history_user_scanned",
      table: "scan_history",
      columns: "user_id, scanned_at DESC",
    },
    {
      name: "idx_api_usage_key_used",
      table: "api_usage",
      columns: "api_key_id, used_at",
    },
    {
      name: "idx_admin_audit_admin_created",
      table: "admin_audit_log",
      columns: "admin_id, created_at DESC",
    },
    {
      name: "idx_admin_audit_target_user",
      table: "admin_audit_log",
      columns: "target_user_id",
      where: "target_user_id IS NOT NULL",
    },
    {
      name: "idx_scan_history_status_pending_running",
      table: "scan_history",
      columns: "status",
      where: "status IN ('pending', 'running')",
    },
    {
      name: "idx_user_notifications_user_unread",
      table: "user_notifications",
      columns: "user_id, created_at DESC",
      where: "read_at IS NULL",
    },
    {
      name: "idx_user_notifications_related",
      table: "user_notifications",
      columns: "related_type, related_id",
      where: "related_type IS NOT NULL",
    },
    {
      name: "idx_host_reputation_last_scanned",
      table: "host_reputation",
      columns: "last_scanned_at",
    },
    {
      name: "idx_github_connections_user",
      table: "github_connections",
      columns: "user_id",
    },
    {
      name: "idx_github_connections_github_user_id",
      table: "github_connections",
      columns: "github_user_id",
    },
    {
      name: "idx_github_review_usage_user_month",
      table: "github_review_usage",
      columns: "user_id, year_month",
    },
  ],

  dataUpdates: [
    {
      sql: ASSIGN_SUPER_ADMIN_SQL,
      label:
        "UPDATE users SET role='super_admin' WHERE id = MIN(id) (idempotent, guarded by NOT EXISTS)",
      destructive: false,
    },
    {
      sql: "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
      label: "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
      destructive: false,
    },
    {
      sql: "UPDATE users SET auth_provider = 'password' WHERE auth_provider IS NULL",
      label: "Backfill auth_provider = 'password' for every existing row",
      destructive: false,
    },
  ],
};

export const downgrade = {
  description:
    "Drop every table and column added by the squashed upgrade, restore " +
    "password_hash NOT NULL (deleting any OAuth-only account with no " +
    "password first), and revert super_admin back to admin. DELETES all " +
    "AI chat history, browser session ownership records, scanner " +
    "feedback, in-app notifications, host reputation cache, GitHub " +
    "connections and review usage, and any OAuth-only account.",

  dropTables: [
    "github_connections",
    "github_review_usage",
    "host_reputation",
    "user_notifications",
    "scan_finding_feedback",
    "browser_sessions",
    "ai_conversations",
  ],

  dropColumns: [
    { table: "scan_history", column: "scan_type" },
    { table: "api_keys", column: "bound_ip" },
    { table: "scan_history", column: "result_meta" },
    { table: "scan_history", column: "error_message" },
    { table: "scan_history", column: "started_at" },
    { table: "scan_history", column: "categories_total" },
    { table: "scan_history", column: "categories_completed" },
    { table: "scan_history", column: "current_category" },
    { table: "scan_history", column: "status" },
    { table: "scan_history", column: "authenticated" },
    { table: "scan_history", column: "share_token_hash" },
    { table: "billing_verification_codes", column: "salt" },
    { table: "users", column: "auth_provider" },
    { table: "users", column: "totp_last_counter" },
    { table: "users", column: "unsubscribe_token" },
  ],

  dropIndexes: ["idx_scan_history_status_pending_running"],

  dataUpdates: [
    {
      sql: "DELETE FROM users WHERE password_hash IS NULL",
      label: "Delete OAuth-only accounts that have no password to fall back to",
      destructive: true,
    },
    {
      sql: "ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL",
      label: "ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL",
      destructive: false,
    },
    {
      sql: REVERT_SUPER_ADMIN_SQL,
      label: "UPDATE users SET role='admin' WHERE role='super_admin'",
      destructive: true,
    },
  ],
};
