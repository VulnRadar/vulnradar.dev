/**
 * Additive schema for the posture-digest feature (AUDIT-010, see
 * lib/notifications/posture-digest.ts).
 *
 * Kept in its own function/file rather than folded into instrumentation.ts's
 * boot-time CREATE TABLE block: every statement below is already an
 * `ADD COLUMN IF NOT EXISTS` self-healing migration (the same pattern used
 * throughout instrumentation.ts for post-launch columns, e.g. api_keys'
 * bound_ip / scopes), so it does not need to live inside that block to be
 * safe to run on every boot -- it just needs to run once, early, alongside
 * the other startup schema calls. See this module's exported
 * ensureDigestSchema() call site notes for the one-line wiring into
 * instrumentation.ts's register().
 */

import pool from "@/lib/database/db";

export async function ensureDigestSchema(): Promise<void> {
  await pool.query(`
    -- Per-user opt-in. Unlike every other email category in
    -- notification_preferences (which defaults to opted-in, see
    -- lib/notifications/notifications.ts's NOTIFICATION_COLUMNS), nobody
    -- receives a digest until they explicitly turn this on -- a new,
    -- previously-nonexistent weekly email should never surprise an
    -- existing user who never asked for it.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS digest_email_enabled BOOLEAN NOT NULL DEFAULT false;

    -- Cursor for "since your last digest" and for cadence gating. NULL
    -- means "never sent one" -- lib/notifications/posture-digest.ts treats
    -- that as the window starting CONFIG_POSTURE_DIGEST_WINDOW_DAYS back
    -- from the moment the first digest actually sends.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ;

    -- Fits the same notification_preferences shape every other category
    -- uses, so a user who has opted in via digest_email_enabled can still
    -- silence just this one email (from the same Notification Preferences
    -- UI as every other category) without disabling every other
    -- notification. Defaults true: once opted in, a user gets the digest
    -- unless they separately dial down this specific category -- the real
    -- opt-in gate is digest_email_enabled above, not this column.
    ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS email_posture_digest BOOLEAN NOT NULL DEFAULT true;
  `);
}
