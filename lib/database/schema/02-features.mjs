/**
 * VulnRadar boot schema, part 2 of 4: feature tables and column additions.
 *
 * Everything added after the v2 baseline, in the order it was added. Almost
 * every step here is either a CREATE TABLE IF NOT EXISTS for a v3 feature or
 * an idempotent ALTER TABLE ... ADD COLUMN IF NOT EXISTS, which is how a
 * running deployment picks up a new column on its next restart without an
 * explicit npm run db:migrate.
 *
 * onError is "warn" throughout, matching the per-block .catch() these steps
 * were written with: one feature's table failing to appear must not stop the
 * rest of the schema, and /api/v3/health plus the boot required-table check
 * both report what actually landed.
 */

/** @type {import("./index.mjs").SchemaStep[]} */
export const featureSchemaSteps = [
  // ════════════════════════════════════════════════════════════════
  // AI CONVERSATIONS - AI chat history (v3)
  // ════════════════════════════════════════════════════════════════
  {
    id: "ai-conversations",
    onError: "warn",
    warning: "Failed to create/verify ai_conversations",
    sql: `
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id SERIAL PRIMARY KEY,
          session_id UUID NOT NULL UNIQUE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          messages JSONB NOT NULL DEFAULT '[]',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON ai_conversations(user_id);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_created_at ON ai_conversations(created_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USER AI CONFIGS - Per-user AI provider settings
  // ════════════════════════════════════════════════════════════════
  {
    id: "user-ai-configs",
    onError: "warn",
    warning: "Failed to create/verify user_ai_configs",
    sql: `
        CREATE TABLE IF NOT EXISTS user_ai_configs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          use_vulnradar_ai BOOLEAN NOT NULL DEFAULT TRUE,
          provider VARCHAR(50),
          model_id VARCHAR(100),
          api_key_encrypted TEXT,
          base_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  {
    id: "user-ai-configs-ai-disabled",
    onError: "warn",
    warning: "Failed to add user_ai_configs.ai_disabled",
    sql: `
        ALTER TABLE user_ai_configs
          ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN NOT NULL DEFAULT FALSE;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USERS v3 columns — email unsubscribe (idempotent via ADD COLUMN IF NOT EXISTS)
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-unsubscribe-token",
    onError: "warn",
    warning: "Failed to add users.unsubscribe_token/ai_chat_banned",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS unsubscribe_token UUID DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS ai_chat_banned BOOLEAN NOT NULL DEFAULT FALSE;

        -- AUDIT-013 schema-09: unsubscribe_token is the ONLY credential the
        -- unauthenticated unsubscribe route has, and it had neither an index
        -- nor a UNIQUE constraint. Every click of an unsubscribe link in any
        -- notification email sequentially scanned the whole users table, and
        -- the uniqueness the route depends on to identify one account was a
        -- convention rather than a guarantee. Backfill first (the column is
        -- nullable and a row inserted before the DEFAULT existed can hold
        -- NULL), then the unique index, exactly the pattern used for
        -- scan_history.public_id further down.
        UPDATE users SET unsubscribe_token = gen_random_uuid()
          WHERE unsubscribe_token IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsubscribe_token
          ON users(unsubscribe_token);
    `,
  },

  // ── users.email case-insensitive uniqueness (AUDIT-013 schema-11) ──
  // `email VARCHAR(255) UNIQUE` gives a CASE-SENSITIVE unique index, so
  // 'Alice@example.com' and 'alice@example.com' are two legal rows. Every
  // read and write normalizes by hand today, and that convention holds,
  // but it is enforced only by each author remembering it: one write path
  // that forgets produces a row getUserByEmail can never find, an account
  // that can never sign in, and a second account for the same human.
  // Kept in its own statement (not the block above) because it is the one
  // index here that can legitimately fail: a database that ALREADY has two
  // addresses differing only in case cannot build it. That case needs a
  // human to decide which account survives, so log it and carry on rather
  // than taking the boot down. The existing UNIQUE constraint stays.
  {
    id: "users-email-lower-index",
    onError: "warn",
    warning:
      "Could not create idx_users_email_lower. This usually means two accounts share an email address differing only in letter case; resolve them by hand, then restart",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email))
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AUDIT-004 v3.1.0 — security hardening columns (idempotent)
  // ════════════════════════════════════════════════════════════════
  {
    id: "security-hardening-columns",
    onError: "warn",
    warning:
      "Failed to add users.totp_last_counter / billing_verification_codes.salt",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT;
        ALTER TABLE billing_verification_codes
          ADD COLUMN IF NOT EXISTS salt TEXT;
    `,
  },

  // share_token_hash is a generated column — separate statement because
  // PostgreSQL disallows mixing generated and regular columns in one ALTER.
  {
    id: "scan-history-share-token-hash",
    onError: "ignore",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_token_hash TEXT
          GENERATED ALWAYS AS (encode(sha256(share_token::bytea), 'hex')) STORED;
        CREATE INDEX IF NOT EXISTS idx_scan_history_share_token_hash
          ON scan_history(share_token_hash)
          WHERE share_token_hash IS NOT NULL;
    `,
  },

  // share_expires_at: optional expiry for a share link, set from
  // POST /api/v3/history/[id]/share's `expiresInDays`. NULL means "never
  // expires" (the pre-existing behavior, unchanged for a caller that
  // doesn't pass the field). GET /api/v3/shared/[token] excludes an
  // expired row from its lookup entirely, the same as a revoked
  // (share_token = NULL) one.
  {
    id: "scan-history-share-expires-at",
    onError: "warn",
    warning: "Failed to add scan_history.share_expires_at",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMP WITH TIME ZONE;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BROADCAST MESSAGES - sent_by, tracking who most recently (re)sent a
  // broadcast, distinct from created_by (who authored the draft). The
  // admin UI (components/admin/features/mass-email-manager.tsx) has
  // rendered a "Sent ... by {sent_by_name}" line and the "resend" action
  // handler (app/api/v3/admin/features/route.ts) has written this column
  // since both were built, but the column itself was never added --
  // every resend attempt 500'd on the UPDATE before anything was queued.
  // ════════════════════════════════════════════════════════════════
  {
    id: "broadcast-messages-sent-by",
    onError: "warn",
    warning: "Failed to add broadcast_messages.sent_by",
    sql: `
        ALTER TABLE broadcast_messages
          ADD COLUMN IF NOT EXISTS sent_by INTEGER REFERENCES users(id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BROWSER SESSIONS - ownership mapping for IDOR prevention (AUDIT-004#idor-01)
  // ════════════════════════════════════════════════════════════════
  {
    id: "browser-sessions",
    onError: "warn",
    warning: "Failed to create/verify browser_sessions",
    sql: `
        CREATE TABLE IF NOT EXISTS browser_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id ON browser_sessions(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN SCREENSHOTS - opt-in above-the-fold capture of the scanned page
  //
  // One row per scan (scan_id PRIMARY KEY, a re-capture overwrites). The
  // image bytes live here as BYTEA rather than in scan_history.result_meta
  // so the owner/shared/status result payloads stay small -- result_meta
  // only carries a tiny {width,height,capturedAt} reference. Captured
  // through the same BrowserBase infrastructure the browser-driven login
  // uses (lib/scanner/page-screenshot.ts), gated behind the metered
  // live-browser minute allowance. ON DELETE CASCADE so a deleted scan's
  // screenshot goes with it.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-screenshots",
    onError: "warn",
    warning: "Failed to create/verify scan_screenshots",
    sql: `
        CREATE TABLE IF NOT EXISTS scan_screenshots (
          scan_id INTEGER PRIMARY KEY REFERENCES scan_history(id) ON DELETE CASCADE,
          image_data BYTEA NOT NULL,
          content_type VARCHAR(40) NOT NULL DEFAULT 'image/jpeg',
          width INTEGER,
          height INTEGER,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USER AVATARS - uploaded profile pictures, one row per user
  //
  // Modeled on scan_screenshots above: image bytes live here as BYTEA
  // rather than as a base64 data URL in users.avatar_url or as a file
  // on disk, so there is a single image-storage mechanism (Postgres)
  // that works identically on self-hosted Docker and serverless. The
  // image is served by app/api/v3/avatar/[userId]/route.ts, which reads
  // it back through lib/uploads/avatar-storage.ts. ON DELETE CASCADE so
  // a deleted user's avatar goes with them. Only locally-uploaded,
  // validated PNG/JPEG bytes land here; external OAuth avatar URLs
  // (cdn.discordapp.com, Google, GitHub) stay as plain URLs in
  // users.avatar_url and never touch this table.
  // ════════════════════════════════════════════════════════════════
  {
    id: "user-avatars",
    onError: "warn",
    warning: "Failed to create/verify user_avatars",
    sql: `
        CREATE TABLE IF NOT EXISTS user_avatars (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          image_data BYTEA NOT NULL,
          content_type TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    `,
  },

  // One-time boot backfill of legacy avatars into the user_avatars table
  // now that it exists, so a plain upgrade heals itself with no separate
  // command. Both steps are idempotent (skip a user that already has a
  // row) and best-effort (never throw): the base64 conversion moves the
  // old serverless-fallback data:image URLs out of users.avatar_url
  // (pure database, a no-op when there are none), and the file import
  // moves legacy data/avatars/<id>.png files on self-hosted Docker (a
  // clean no-op when there is no such directory, e.g. on serverless).

  // ════════════════════════════════════════════════════════════════
  // SCAN FINDING FEEDBACK - user verdicts for scanner learning
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so a fresh `docker compose up` gets this table without an explicit
  // `npm run db:migrate` — every other v3+ table follows the same
  // auto-create-on-boot + explicit-migration dual path.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-finding-feedback",
    onError: "warn",
    warning: "Failed to create/verify scan_finding_feedback",
    sql: `
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
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FINDING REMEDIATION - the OWNER's per-finding status lifecycle
  // (open / in_progress / fixed / accepted_risk / wont_fix + optional
  // note + free-text assignee). Private to the user (ON DELETE CASCADE,
  // unlike scan_finding_feedback which is SET NULL because it feeds the
  // global learning model). Keyed on (user_id, finding_id, finding_url),
  // NOT scan_history_id, so a status set on one scan persists across
  // rescans of the same target -- finding_id is the stable
  // <checkId>--<hash> id from generateId (lib/scanner/_helpers.ts).
  // `open` is the implicit default: absence of a row.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so a fresh `docker compose up` gets this table without an explicit
  // `npm run db:migrate` -- same auto-create-on-boot + explicit-migration
  // dual path as scan_finding_feedback above.
  // ════════════════════════════════════════════════════════════════
  {
    id: "finding-remediation",
    onError: "warn",
    warning: "Failed to create/verify finding_remediation",
    sql: `
        CREATE TABLE IF NOT EXISTS finding_remediation (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          finding_id TEXT NOT NULL,
          finding_url TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'fixed', 'accepted_risk', 'wont_fix')),
          note TEXT,
          assignee TEXT,
          due_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        -- due_at (a target/SLA date for the remediation) added after the
        -- table shipped, so an existing install needs the idempotent ALTER.
        ALTER TABLE finding_remediation ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_finding_remediation_unique
          ON finding_remediation (user_id, finding_id, finding_url);
        CREATE INDEX IF NOT EXISTS idx_finding_remediation_user
          ON finding_remediation (user_id, updated_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN CREDENTIALS REMOVED (v5.5.0) — authenticated scanning is
  // fully ephemeral: a caller supplies login material directly in a
  // single scan request (see app/api/v3/scan/authenticated/route.ts
  // and lib/scanner/auth/), it lives only in memory for that one
  // request, and it is never written anywhere. There is no CREATE
  // TABLE scan_credentials here anymore, so a fresh install never
  // creates it. The DROP below makes an already-running deployment
  // that did create it converge on its next restart, without an
  // explicit `npm run db:migrate`, matching every schema change since
  // v4.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration.
  // ════════════════════════════════════════════════════════════════
  {
    id: "drop-scan-credentials",
    onError: "warn",
    warning: "Failed to drop scan_credentials",
    sql: `DROP TABLE IF EXISTS scan_credentials CASCADE;
    `,
  },

  // scan_history.authenticated stays: a plain boolean fact ("this scan
  // ran authenticated") that never held credential material and still
  // doesn't. credential_id pointed at scan_credentials and is dropped
  // along with it.
  {
    id: "scan-history-authenticated-columns",
    onError: "warn",
    warning: "Failed to reconcile scan_history authenticated-scan columns",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS authenticated BOOLEAN NOT NULL DEFAULT false,
          DROP COLUMN IF EXISTS credential_id;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PERFORMANCE INDEXES (infra audit) — composite indexes for the
  // query shapes actually run on the hot paths (session-scoped scan
  // history listing, per-API-key daily rate limiting, and the admin
  // audit log).
  //
  // This comment used to say the single-column indexes above each table
  // were "left in place; these are additive, not replacements, so
  // unrelated query shapes that only filter on one of the columns keep
  // working the same way". That premise is wrong, and it is the reasoning
  // that produced three of the duplicates dropped at the end of this
  // function: a b-tree index on (A, B) is fully usable for a query that
  // filters on A alone, because A is the leading column. A composite index
  // leading with A therefore REPLACES a single-column index on A, and
  // keeping both only pays to maintain the second copy on every write.
  // The single-column indexes on scan_history(user_id),
  // api_usage(api_key_id) and admin_audit_log(admin_id) are gone for that
  // reason. ref: AUDIT-013#schema-05
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so an already-running v3+ deployment picks these up on its next
  // restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "performance-indexes",
    onError: "warn",
    warning: "Failed to create performance indexes",
    sql: `
        CREATE INDEX IF NOT EXISTS idx_scan_history_user_scanned
          ON scan_history(user_id, scanned_at DESC);
        CREATE INDEX IF NOT EXISTS idx_api_usage_key_used
          ON api_usage(api_key_id, used_at);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_created
          ON admin_audit_log(admin_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_target_user
          ON admin_audit_log(target_user_id)
          WHERE target_user_id IS NOT NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // RETENTION, FOREIGN-KEY AND HOT-PATH INDEXES
  // (AUDIT-012 perf-05/perf-15, AUDIT-013 schema-03)
  //
  // Three groups, all missing before:
  //
  //  1. Timestamp columns the nightly retention pass deletes on
  //     (lib/database/cleanup.ts). Each of these tables' only
  //     timestamp index was a composite led by user_id, which a
  //     timestamp-only range scan cannot use, so the prune was a
  //     sequential scan of the fastest-growing tables in the schema,
  //     inside one transaction.
  //
  //  2. Foreign-key child columns. PostgreSQL does NOT index a FK
  //     child column automatically, and it runs one lookup per
  //     deleted parent row (DELETE for CASCADE, UPDATE for SET NULL).
  //     The two that matter are the scan_history children, because
  //     they fire once per pruned scan; the rest are per-deleted-user
  //     and are declared partial so they stay near-empty on a column
  //     that is NULL for almost every row.
  //
  //  3. Query shapes with an index that exists but cannot be used.
  //     The badge route joins scan_history on url and the only url
  //     index is partial on is_public, whose predicate that join
  //     deliberately does not imply.
  //
  // Cost note: these are plain CREATE INDEX, not CONCURRENTLY, which
  // takes a SHARE lock that blocks writes to the table for the build.
  // At production size that is milliseconds. On a large scan_history
  // the two indexes on that table are the ones to watch, and an
  // operator with a big table should create them CONCURRENTLY by hand
  // before deploying, after which these statements become no-ops.
  // ════════════════════════════════════════════════════════════════
  {
    id: "retention-and-foreign-key-indexes",
    onError: "warn",
    warning: "Failed to create retention/foreign-key indexes",
    sql: `
        -- (3) The badge/shared-scan join: sh.url = hb.url ORDER BY
        -- sh.scanned_at DESC. Also serves the DISTINCT ON (url) ... ORDER
        -- BY url, scanned_at DESC sorts and regression-alert's per-URL
        -- lookup after every completed scan.
        CREATE INDEX IF NOT EXISTS idx_scan_history_url_scanned
          ON scan_history(url, scanned_at DESC);

        -- (1) Retention prunes.
        CREATE INDEX IF NOT EXISTS idx_rate_limits_window
          ON rate_limits(window_start);
        CREATE INDEX IF NOT EXISTS idx_sff_created
          ON scan_finding_feedback(created_at);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_last_msg
          ON ai_conversations(last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_device_trust_expires_at
          ON device_trust(expires_at);

        -- (3) Triage lookups. Both tables have a UNIQUE
        -- (user_id, finding_id, finding_url) with finding_id sitting
        -- between the two columns these queries actually filter on, so
        -- only user_id was usable as a key and the lookup cost scaled
        -- with the user's whole triage history rather than with the
        -- findings for one URL. The three-column UNIQUEs stay: they back
        -- the ON CONFLICT clauses in the remediation and feedback routes.
        CREATE INDEX IF NOT EXISTS idx_finding_remediation_user_url
          ON finding_remediation(user_id, finding_url);
        CREATE INDEX IF NOT EXISTS idx_sff_user_url
          ON scan_finding_feedback(user_id, finding_url);

        -- (2) scan_history children. These fire once per pruned scan.
        CREATE INDEX IF NOT EXISTS idx_sff_scan_history_id
          ON scan_finding_feedback(scan_history_id)
          WHERE scan_history_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_scan_tags_tag
          ON scan_tags(tag);

        -- (2) users children hit by DELETE FROM users, plus the explicit
        -- DELETE ... WHERE user_id that precedes every token issue.
        CREATE INDEX IF NOT EXISTS idx_prt_user_id
          ON password_reset_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_evt_user_id
          ON email_verification_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_teams_owner_id
          ON teams(owner_id);
        CREATE INDEX IF NOT EXISTS idx_team_invites_email
          ON team_invites(email);

        -- (2) Bookkeeping FK columns, partial so they stay tiny.
        CREATE INDEX IF NOT EXISTS idx_sessions_impersonated_by
          ON sessions(impersonated_by) WHERE impersonated_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_user_badges_awarded_by
          ON user_badges(awarded_by) WHERE awarded_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id
          ON user_badges(badge_id);
        CREATE INDEX IF NOT EXISTS idx_admin_user_notes_admin_id
          ON admin_user_notes(admin_id) WHERE admin_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_team_invites_invited_by
          ON team_invites(invited_by) WHERE invited_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_gifted_by
          ON gifted_subscriptions(gifted_by) WHERE gifted_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_revoked_by
          ON gifted_subscriptions(revoked_by) WHERE revoked_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_created_by
          ON admin_notifications(created_by) WHERE created_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_access_rules_created_by
          ON access_rules(created_by) WHERE created_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_security_alerts_resolved_by
          ON security_alerts(resolved_by) WHERE resolved_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by
          ON system_settings(updated_by) WHERE updated_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_broadcast_messages_created_by
          ON broadcast_messages(created_by) WHERE created_by IS NOT NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BACKGROUND SCAN JOBS (v5.2.0) — a scan runs detached from the HTTP
  // request that started it (see app/api/v3/scan/route.ts). These
  // columns let a status route poll and cancel it instead of holding
  // the request open. `status` defaults to 'completed' so every other
  // INSERT into scan_history that doesn't specify it (bulk scan,
  // authenticated scan — both still run synchronously) keeps its
  // existing meaning: a finished scan.
  //
  // Same DDL as scripts/migrate/versions/5.1.0-to-5.2.0.mjs, applied
  // here too so an already-running v3+ deployment picks these up on
  // its next restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history-background-jobs",
    onError: "warn",
    warning: "Failed to add scan_history background-job columns",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed'
            CHECK (status IN ('pending', 'running', 'completed', 'failed')),
          ADD COLUMN IF NOT EXISTS current_category VARCHAR(30),
          ADD COLUMN IF NOT EXISTS categories_completed INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS categories_total INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
          ADD COLUMN IF NOT EXISTS error_message TEXT,
          ADD COLUMN IF NOT EXISTS result_meta JSONB;
        CREATE INDEX IF NOT EXISTS idx_scan_history_status_pending_running
          ON scan_history(status)
          WHERE status IN ('pending', 'running');
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USER NOTIFICATIONS (v5.3.0) — per-user in-app notification inbox
  // (the bell), distinct from admin_notifications (a staff-authored
  // broadcast to an audience segment with no single recipient). First
  // producer: POST /api/v3/teams/members, which inserts a row here
  // when a team invite is sent to an email address that already has
  // an account. related_type/related_id point back at the source
  // record (e.g. team_invites.id) so it can be marked read once
  // handled — see lib/notifications/user-notifications.ts.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so an already-running v3+ deployment picks this up on its next
  // restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "user-notifications",
    onError: "warn",
    warning: "Failed to create/verify user_notifications",
    sql: `
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
        CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
          ON user_notifications(user_id, created_at DESC)
          WHERE read_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_user_notifications_related
          ON user_notifications(related_type, related_id)
          WHERE related_type IS NOT NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // HOST REPUTATION (v5.7.0) — host-level "has anyone ever scanned
  // this site, and what did the latest scan find" cache for the
  // browser extension's popup (see app/api/v3/scan/reputation/route.ts).
  // Deliberately keyed by `host` (the normalized root domain from
  // lib/scanner/root-domain.ts) with NO user_id column: this is
  // public-safety data about a website, not personal data about who
  // scanned it, so it must survive a user deleting their scan
  // history, downgrading, or deleting their account entirely.
  //
  // source_scan_id is a best-effort deep link to the scan_history row
  // that produced the cached summary, for a "view full report" link.
  // It has NO CASCADE: ON DELETE SET NULL means a user deleting that
  // scan (retention, account deletion) only nulls this one pointer
  // column, it never deletes or touches the cached reputation row
  // itself.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so an already-running v3+ deployment picks this up on its next
  // restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-reputation",
    onError: "warn",
    warning: "Failed to create/verify host_reputation",
    sql: `
        CREATE TABLE IF NOT EXISTS host_reputation (
          host VARCHAR(255) PRIMARY KEY,
          danger_score INTEGER NOT NULL,
          severity_counts JSONB NOT NULL DEFAULT '{}',
          last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_scan_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_host_reputation_last_scanned
          ON host_reputation(last_scanned_at);
        -- source_scan_id is filtered on by the false-positive recompute and the
        -- private-toggle/scan-delete purge; without this each was a full scan of
        -- the reputation table (one row per host ever scanned).
        CREATE INDEX IF NOT EXISTS idx_host_reputation_source_scan_id
          ON host_reputation(source_scan_id)
          WHERE source_scan_id IS NOT NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // HOST REPUTATION - full findings snapshot, not just the summary.
  //
  // The extension popup originally only got danger_score/severity_counts
  // plus a best-effort source_scan_id deep link -- fine for a score
  // badge, not enough to show real findings, and the link goes dead
  // the moment the owning user deletes that scan (retention, account
  // deletion, downgrade). findings/response_headers are a full,
  // self-contained COPY of the latest scan's result for this host, in
  // the same shape scan_history stores them in, so this table never
  // depends on a scan_history row surviving. Nullable/defaulted so this
  // is a no-op on a database that already has rows from before this
  // column existed until the next scan of that host refreshes them.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-reputation-findings",
    onError: "warn",
    warning: "Failed to add host_reputation.findings/response_headers",
    sql: `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS findings JSONB NOT NULL DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS response_headers JSONB;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // HOST REPUTATION - result_meta + authenticated, matching scan_history.
  //
  // The public /host/[hostname] page rendered only a bare danger score
  // and severity counts -- no checks-run count, engine confidence, or
  // authenticated badge the way /shared/[token] and the History detail
  // view show, because host_reputation never stored the same
  // result_meta blob scan_history does. Nullable/defaulted so this is a
  // no-op on existing rows until the next scan of that host refreshes
  // them.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-reputation-result-meta",
    onError: "warn",
    warning: "Failed to add host_reputation.result_meta/authenticated",
    sql: `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS result_meta JSONB NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS authenticated BOOLEAN NOT NULL DEFAULT FALSE;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // HOST REPUTATION - scanned_url, the exact page the cached result
  // actually came from.
  //
  // host_reputation is keyed by host, not by page, so a scan of one
  // page (e.g. one repo on github.com) becomes "the reputation" shown
  // for every other unrelated page on that host too. GET
  // /api/v3/scan/reputation now tries an exact-URL match first (see
  // getExactUrlReputation in lib/scanner/host-reputation.ts) and only
  // falls back to this host-level row when there's no exact match --
  // when it does, the response needs to say which page this data
  // actually came from so the extension can show "last known scan was
  // of X" instead of implying a rating of the page the visitor is
  // currently on. source_scan_id alone isn't enough for this: it goes
  // NULL the moment the owning user deletes that scan_history row
  // (ON DELETE SET NULL above), which would silently lose the
  // attribution. Nullable/defaulted so this is a no-op on existing
  // rows until the next scan of that host refreshes them.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-reputation-scanned-url",
    onError: "warn",
    warning: "Failed to add host_reputation.scanned_url",
    sql: `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS scanned_url TEXT;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // HOST REPUTATION - auto_tags, the same rule-computed tags
  // (lib/tags/auto-tags.ts) a logged-in scan owner already sees on
  // their own scan, computed from the same findings snapshot this
  // table already stores. A stored snapshot rather than a live join
  // to scan_tags for the same reason findings/response_headers above
  // are snapshots: this table must keep showing accurate data even
  // after the owning scan_history row (and its scan_tags) is gone.
  // Only the deterministic base ruleset runs here, not admin-promoted
  // rules or the AI fallback -- both need their own DB round-trip,
  // and this stays a fast, dependency-light write like the rest of
  // upsertHostReputation. Nullable/defaulted so this is a no-op on
  // existing rows until the next scan of that host refreshes them.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-reputation-auto-tags",
    onError: "warn",
    warning: "Failed to add host_reputation.auto_tags",
    sql: `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS auto_tags JSONB NOT NULL DEFAULT '[]';
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // OAUTH SIGNUP/LOGIN (v5.8.0) — Google/GitHub/Discord sign-in that can
  // create a brand new account, not just link one onto an existing
  // session (see app/api/v3/auth/oauth/[provider]/). auth_provider
  // records which path created the row: 'password' | 'google' |
  // 'github' | 'discord'. NULL means a legacy row from before this
  // column existed; every read site treats NULL the same as
  // 'password' (see lib/auth/oauth-providers.ts's
  // oauthLabelForAuthProvider), so the UPDATE backfill below is a
  // convenience, not a correctness requirement.
  //
  // password_hash is nullable because an OAuth-created account may
  // never set one. lib/auth/password-hash.ts's verifyPassword() treats
  // a null hash as "no match" (never throws), and
  // app/api/v3/auth/update/route.ts's re-auth gate skips the
  // current-password check for a user in this state so they are never
  // locked out of their own profile.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
  // so an already-running v3+ deployment picks this up on its next
  // restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-auth-provider",
    onError: "warn",
    warning: "Failed to reconcile users OAuth columns",
    sql: `
        ALTER TABLE users
          ALTER COLUMN password_hash DROP NOT NULL,
          ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20);
        UPDATE users SET auth_provider = 'password' WHERE auth_provider IS NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GITHUB CONNECTIONS - account-linked GitHub OAuth (repo-read scan)
  //
  // Separate from any identity-only "Sign in with GitHub" OAuth: this
  // is an ADDITIONAL flow where an already-logged-in user connects
  // their GitHub account so VulnRadar can read their repo source for
  // a code-security scan. Started from app/api/v3/account/github/connect/,
  // different scope (repo, not identity) -- but completes through the
  // SAME callback as sign-in (app/api/v3/auth/oauth/github/callback,
  // purpose: "github-connect" in lib/auth/oauth-state.ts) since GitHub
  // OAuth Apps only accept one registered callback URL.
  //
  // access_token_encrypted uses the same AES-256-GCM helper
  // (lib/auth/crypto.ts encryptApiKey/decryptApiKey) already used for
  // discord_connections.access_token and user_ai_configs.api_key_encrypted
  // -- one encryption-at-rest story for every third-party secret this
  // app stores, not a second bespoke implementation.
  //
  // scopes records exactly what GitHub granted (from the token
  // exchange response), for display in the UI and for a future
  // capability check. Judgment call: classic GitHub OAuth apps have no
  // scope that grants read-ONLY access to private repository contents
  // -- `repo` bundles read+write to private repos (the write half is
  // simply never used by this feature), `public_repo` would read-only
  // scope public repos but silently exclude private ones from listing
  // entirely. lib/github/github-oauth.ts requests `repo` so "connect
  // GitHub" behaves the way a user expects (their private repos show
  // up to scan). A GitHub App with fine-grained `contents:read` would
  // be the tighter alternative if this needs revisiting.
  // ════════════════════════════════════════════════════════════════
  {
    id: "github-connections",
    onError: "warn",
    warning: "Failed to create/verify github_connections",
    sql: `
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
        CREATE UNIQUE INDEX IF NOT EXISTS idx_github_connections_github_user_id
          ON github_connections(github_user_id);
        -- selected_repos: the curated working set from the repo picker
        -- modal (components/repos/github-repo-picker-modal.tsx).
        -- ADD COLUMN IF NOT EXISTS (rather than folding into the CREATE
        -- TABLE above) so an already-running deployment that created this
        -- table before this column existed picks it up on its next
        -- restart, same pattern as auth_provider on users above.
        ALTER TABLE github_connections
          ADD COLUMN IF NOT EXISTS selected_repos JSONB NOT NULL DEFAULT '[]'::jsonb;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GITHUB REVIEW USAGE - fixed-window AI TOKEN counter for the
  // githubReviewTokensPerWindow plan limit (lib/billing/plan-limits.ts).
  //
  // Tracks tokens, not a run tally: repos vary enormously in size, so
  // a flat "N runs/window" cap doesn't bound cost the way a token cap
  // does (one huge repo can burn as many tokens as hundreds of small
  // ones). tokens_used accumulates the REAL usage the AI provider
  // reports per call (see lib/ai/review-source.ts), not a pre-run
  // estimate -- the estimate is only used for the separate, per-run
  // ceiling that every run must additionally respect (see
  // GITHUB_REVIEW_MAX_TOKENS_PER_RUN in lib/config/registry.ts).
  //
  // window_start is the exact same fixed AI_USAGE_WINDOW_HOURS bucket
  // ai_usage.window_start uses below (see lib/billing/ai-usage.ts's
  // currentWindowStart/resolveCurrentWindow, imported directly rather
  // than duplicated) -- this table used to key on a calendar-month
  // year_month column instead, on its own independent cadence; the
  // product decision was to fold GitHub review onto the same window
  // as everything else instead. Deliberately a standalone table
  // rather than reusing ai_usage's own rows: a whole-repo review call
  // is a very different size than one chat/verify/summary call, so
  // keeping separate counters/caps per feature is simpler than
  // merging them into one shared number.
  //
  // Only ever incremented when the user is scanning with VulnRadar's
  // own AI (use_vulnradar_ai = true in user_ai_configs); a user
  // scanning with their own AI provider key bypasses this table
  // entirely (see lib/billing/github-review-usage.ts), since VulnRadar
  // isn't paying for those AI calls.
  // ════════════════════════════════════════════════════════════════
  {
    id: "github-review-usage",
    onError: "warn",
    warning: "Failed to create/verify github_review_usage",
    sql: `
        CREATE TABLE IF NOT EXISTS github_review_usage (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          window_start TIMESTAMPTZ NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GITHUB REVIEW USAGE CADENCE FIX - year_month -> window_start
  //
  // github_review_usage was originally created (above) keyed by a
  // calendar-month year_month column. That never shipped to any real
  // database (production is still on v2.3.2), but a local/dev server
  // that already booted against the old CREATE TABLE shape needs a
  // real migration, not just a no-op CREATE TABLE IF NOT EXISTS --
  // every statement below is idempotent (IF EXISTS/IF NOT EXISTS
  // guards throughout) and a total no-op on a database that only ever
  // saw the window_start shape above.
  // ════════════════════════════════════════════════════════════════
  // AUDIT-013 migrate-14: this used to be a single
  // `ADD COLUMN window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
  // NOW() is transaction-start time and is evaluated ONCE, so every
  // pre-existing row received the identical window_start: a user with
  // rows for two different calendar months collapsed onto one
  // (user_id, window_start) pair, and the UNIQUE constraint added
  // below then failed with "Key is duplicated". Because that whole
  // block is .catch-guarded here, the table was left with NO unique
  // constraint at all, and every subsequent
  // `INSERT ... ON CONFLICT (user_id, window_start)` in
  // lib/billing/github-review-usage.ts failed with "there is no unique
  // or exclusion constraint matching the ON CONFLICT specification":
  // GitHub AI review usage stopped being recorded entirely.
  //
  // Nullable first, backfilled deterministically from the old key so
  // rows for different months stay distinct, then made NOT NULL. Same
  // statements, same order, as the migration path's dataUpdates in
  // scripts/migrate/versions/2.0.0-to-3.0.0.mjs.
  {
    id: "github-review-usage-window-start",
    onError: "warn",
    warning: "Failed to add github_review_usage.window_start",
    sql: `ALTER TABLE github_review_usage ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ;
    `,
  },

  {
    id: "github-review-usage-window-migration",
    onError: "warn",
    warning: "Failed to migrate github_review_usage off year_month",
    sql: `
        -- DO block because year_month does not exist on a database that
        -- only ever saw the window_start shape, and a plain UPDATE naming
        -- a missing column errors rather than no-opping.
        DO $gru$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'github_review_usage'
              AND column_name = 'year_month'
          ) THEN
            EXECUTE 'UPDATE github_review_usage
                        SET window_start = to_timestamp(year_month || ''-01'', ''YYYY-MM-DD'')
                      WHERE window_start IS NULL AND year_month IS NOT NULL';
          END IF;
        END
        $gru$;
        UPDATE github_review_usage SET window_start = NOW() WHERE window_start IS NULL;
        ALTER TABLE github_review_usage
          ALTER COLUMN window_start SET DEFAULT NOW();
        ALTER TABLE github_review_usage
          ALTER COLUMN window_start SET NOT NULL;
        ALTER TABLE github_review_usage
          DROP CONSTRAINT IF EXISTS github_review_usage_user_id_year_month_key;
        ALTER TABLE github_review_usage
          DROP COLUMN IF EXISTS year_month;
        ALTER TABLE github_review_usage
          DROP CONSTRAINT IF EXISTS github_review_usage_user_window_key;
        ALTER TABLE github_review_usage
          ADD CONSTRAINT github_review_usage_user_window_key UNIQUE (user_id, window_start);
    `,
  },

  // The index this used to replace it with, idx_github_review_usage_user_window
  // on (user_id, window_start), duplicated the UNIQUE constraint added
  // directly above, so it is dropped with the rest of the redundant set at
  // the end of this function rather than created here. ref: AUDIT-013#schema-05
  {
    id: "drop-idx-github-review-usage-user-month",
    onError: "warn",
    warning: "Failed to drop the old github_review_usage year_month index",
    sql: `
        DROP INDEX IF EXISTS idx_github_review_usage_user_month;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN HISTORY - scan_type discriminator (GitHub repo scans)
  //
  // Reuses scan_history instead of a parallel table: a GitHub repo
  // scan's results are still a Vulnerability[] (lib/scanner/types.ts,
  // extended with an optional `location` field for file/line
  // references) that fit the existing `findings`/`summary` JSONB
  // columns as-is, so history list, compare, export, and the
  // AI-review button all keep working with no new UI plumbing.
  // Defaults to 'web' so every pre-existing row (and every INSERT
  // that doesn't know about this column yet) keeps its current
  // behavior unchanged. `url` holds `owner/repo` for a github-type
  // scan (there is no live URL to store).
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history-scan-type",
    onError: "warn",
    warning: "Failed to add scan_history.scan_type",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS scan_type VARCHAR(20) NOT NULL DEFAULT 'web';
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USERS v3 columns -- Google/GitHub account linking (Connections tab)
  //
  // Same "invisible until configured" identity-linking feature as
  // discord_id above, extended to Google and GitHub: an
  // already-logged-in user attaches a provider identity to their
  // existing account from components/profile/tabs/profile-social-tab.tsx,
  // completed by app/api/v3/auth/oauth/[provider]/callback/route.ts's
  // handleOAuthLink(). Deliberately NOT the same shape as
  // discord_connections -- that table also stores OAuth tokens
  // (refreshed for guild-join / future avatar sync); this feature never
  // calls the provider's API again after the initial link, so there is
  // nothing to refresh and no token worth storing. *_id is the
  // provider's stable account identifier (Google's `sub`, GitHub's
  // numeric user id -- see lib/auth/oauth-userinfo.ts's OAuthUserInfo.id),
  // never the email, so a user changing their Google/GitHub email can't
  // silently detach the link. UNIQUE on *_id is the DB-level backstop
  // against two VulnRadar accounts claiming the same provider identity;
  // the callback's pre-check SELECT is the friendly error message, this
  // is the guarantee.
  //
  // Also unrelated to github_connections (below) and
  // app/api/v3/account/github/ -- that is a SEPARATE feature (repo-read
  // access for code scanning), keyed by github_user_id, with its own
  // OAuth app scopes and its own access token. Do not conflate the two.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-google-github-link",
    onError: "warn",
    warning: "Failed to reconcile users Google/GitHub link columns",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS google_id VARCHAR(64) UNIQUE,
          ADD COLUMN IF NOT EXISTS google_email VARCHAR(255),
          ADD COLUMN IF NOT EXISTS google_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS google_avatar_url TEXT,
          ADD COLUMN IF NOT EXISTS github_id VARCHAR(64) UNIQUE,
          ADD COLUMN IF NOT EXISTS github_email VARCHAR(255),
          ADD COLUMN IF NOT EXISTS github_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS github_avatar_url TEXT,
          -- github_login: the GitHub @handle (login) for a GitHub SIGN-IN,
          -- captured by the oauth-userinfo login field. Distinct from
          -- github_name (the display name, which is NOT a valid github.com
          -- URL) and from github_connections.github_username (the separate
          -- repo-connect feature). Populated on next sign-in for rows that
          -- predate this column; NULL until then.
          ADD COLUMN IF NOT EXISTS github_login TEXT;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USERS v3 columns -- Discord username/avatar/email, parallel to the
  // Google/GitHub columns just above. users.discord_id already existed
  // (it predates this Connections-tab feature), but nothing stored a
  // display name or photo alongside it -- fine for the legacy
  // discord_connections-backed "connect" flow (profile-social-tab.tsx's
  // Discord card reads from THAT table instead), but the newer unified
  // sign-in/sign-up OAuth flow (app/api/v3/auth/oauth/discord/) can
  // create an account directly, with no discord_connections row at
  // all. Without these, that account's Discord identity would show up
  // half-populated: connected (discord_id is set) but "Unknown User"
  // with no avatar.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-discord-profile",
    onError: "warn",
    warning: "Failed to reconcile users Discord profile columns",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100),
          ADD COLUMN IF NOT EXISTS discord_avatar_url TEXT,
          ADD COLUMN IF NOT EXISTS discord_email VARCHAR(255);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN HISTORY - is_public (v5.9.0) — per-host public scan pages at
  // /host/[hostname] (app/host/[hostname]/page.tsx), similar to
  // securityheaders.com or SSL Labs: a host's latest scan is visible to
  // anyone at a stable URL, backed by the host_reputation cache above.
  // Defaults to true ("its on by default" per the product decision) so
  // every pre-existing row, and every INSERT that doesn't set this
  // column yet, keeps contributing to host_reputation unchanged.
  //
  // Toggled after the fact via PATCH /api/v3/history/[id]
  // (app/api/v3/history/[id]/route.ts). Flipping true -> false there
  // also deletes the host_reputation row this scan sourced (matched by
  // source_scan_id), so the public page falls back to "not scanned yet"
  // instead of continuing to show a scan its owner just hid. See
  // lib/scanner/host-reputation.ts's upsertHostReputation call sites,
  // which now skip the upsert entirely for a non-public scan.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history-is-public",
    onError: "warn",
    warning: "Failed to add scan_history.is_public",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USERS - scans_private_by_default (privacy audit follow-up). An
  // account-level default for the per-scan is_public column above:
  // when true, a new scan whose request never says isPublic one way or
  // the other (see lib/scanner/scan-privacy.ts's resolveScanIsPublic,
  // used by app/api/v3/scan/route.ts, scan/crawl/route.ts, and
  // scheduled-scans-worker.ts) is created private instead of falling
  // back to scan_history.is_public's own true default. Defaults to
  // false so an existing account's behavior is unchanged until it
  // opts in via the Privacy tab (components/profile/tabs/
  // profile-privacy-tab.tsx, PUT /api/v3/account/privacy).
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-scans-private-by-default",
    onError: "warn",
    warning: "Failed to add users.scans_private_by_default",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS scans_private_by_default BOOLEAN NOT NULL DEFAULT false;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // CVE KEV CACHE - CISA's Known Exploited Vulnerabilities catalog,
  // cached whole (single row) so lib/scanner/cve-enrichment.ts's
  // post-scan finding enrichment doesn't refetch the feed on every
  // scan. Same shape/pattern as subdomain_cache above: a fixed key,
  // a JSONB payload, and a cached_at the reader compares against a TTL
  // window. Optional-effect: if this table or the feed is ever
  // unreachable, enrichment fails open and findings are returned
  // unmodified (see cve-enrichment.ts).
  // ════════════════════════════════════════════════════════════════
  {
    id: "cve-kev-cache",
    onError: "warn",
    warning: "Failed to create/verify cve_kev_cache",
    sql: `
        CREATE TABLE IF NOT EXISTS cve_kev_cache (
          cache_key VARCHAR(50) PRIMARY KEY,
          cve_ids JSONB NOT NULL,
          cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCHEDULED SCANS - time-of-day preferences, for the worker that
  // actually executes this feature (lib/scanner/scheduled-scans-worker.ts).
  // Previously scheduled_scans.next_run_at was written but never read by
  // anything -- creating/deleting a schedule worked, but nothing ever
  // triggered the scan itself. These columns let a schedule pin WHEN in
  // its cadence it runs (an hour of day; for weekly, also a day of
  // week; for monthly, also a day of month, capped at 28 so every month
  // has that day) instead of the worker always doing a blind "now plus
  // interval". Always populated (NOT NULL) so lib/scanner/schedule-timing.ts's
  // computeNextRunAt never has to guess a caller's intent from a NULL --
  // the API route fills these from the request (or a "now"-derived
  // default) at creation time; existing rows from before this migration
  // get the flat defaults below, which only changes the exact hour/day
  // those pre-existing schedules land on going forward, never whether
  // they run at all.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scheduled-scans-preferred-time",
    onError: "warn",
    warning: "Failed to add scheduled_scans preferred_* columns",
    sql: `
        ALTER TABLE scheduled_scans
          ADD COLUMN IF NOT EXISTS preferred_hour_utc SMALLINT NOT NULL DEFAULT 0
            CHECK (preferred_hour_utc BETWEEN 0 AND 23),
          ADD COLUMN IF NOT EXISTS preferred_day_of_week SMALLINT NOT NULL DEFAULT 1
            CHECK (preferred_day_of_week BETWEEN 0 AND 6),
          ADD COLUMN IF NOT EXISTS preferred_day_of_month SMALLINT NOT NULL DEFAULT 1
            CHECK (preferred_day_of_month BETWEEN 1 AND 28);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // WEBHOOKS v2 — HMAC signing secret + delivery log (AUDIT follow-up).
  // Previously a webhook receiver had no way to verify a payload
  // actually came from VulnRadar (no secret to check an HMAC against),
  // and a failed delivery (non-2xx or network error) was invisible --
  // execute-scan.ts never checked the delivery response. `secret` is
  // generated server-side by the POST handler
  // (randomBytes(32).toString("hex"), see app/api/v3/webhooks/route.ts)
  // and returned once, the same "shown once" pattern as an API key's
  // raw_key. The DEFAULT below only backfills rows created before this
  // migration existed: two concatenated gen_random_uuid()s with their
  // hyphens stripped give the same 64-hex-char shape as the
  // app-generated secret without requiring the pgcrypto extension
  // (gen_random_uuid() is already relied on above for
  // users.unsubscribe_token). webhook_deliveries is a lean audit/debug
  // log, not a payload archive -- one row per attempt (including the
  // single retry; see lib/webhooks/delivery.ts), the HTTP status (null
  // on a network error or an SSRF block), and a short response
  // snippet, never the full request/response body.
  // ════════════════════════════════════════════════════════════════
  {
    id: "webhooks-secret",
    onError: "warn",
    warning: "Failed to add webhooks.secret",
    sql: `
        ALTER TABLE webhooks
          ADD COLUMN IF NOT EXISTS secret TEXT DEFAULT (
            replace(gen_random_uuid()::text, '-', '') ||
            replace(gen_random_uuid()::text, '-', '')
          );
    `,
  },

  {
    id: "webhook-deliveries",
    onError: "warn",
    warning: "Failed to create/verify webhook_deliveries",
    sql: `
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id SERIAL PRIMARY KEY,
          webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_type VARCHAR(50) NOT NULL,
          http_status INTEGER,
          response_snippet TEXT,
          attempted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
          ON webhook_deliveries(webhook_id, attempted_at DESC);
    `,
  },

  // EXACT-URL REPUTATION LOOKUP — GET /api/v3/scan/reputation now tries
  // an exact-URL match (lib/scanner/host-reputation.ts's
  // getExactUrlReputation) before falling back to the host-level
  // aggregate, so a scan of one page on a host (e.g. one GitHub repo)
  // no longer gets shown as the reputation of every other unrelated
  // page on that same host. That lookup runs on every popup open for
  // every page a user visits, so it needs an index -- partial, scoped
  // to exactly the WHERE clause the query uses, so it stays small and
  // never indexes a private or incomplete scan that could never match.
  {
    id: "scan-history-url-public-completed-index",
    onError: "warn",
    warning: "Failed to create idx_scan_history_url_public_completed",
    sql: `
        CREATE INDEX IF NOT EXISTS idx_scan_history_url_public_completed
          ON scan_history(url)
          WHERE is_public = true AND status = 'completed';
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AI USAGE - fixed-window AI TOKEN counter for the aiTokensPerWindow
  // plan limit (lib/billing/plan-limits.ts), shared across AI chat
  // (app/api/v3/ai/chat), AI finding verification
  // (lib/ai/verify-findings.ts), and AI scan summaries
  // (lib/ai/scan-summary.ts). GitHub repo AI code review resets on
  // this exact same window (github_review_usage above, keyed by its
  // own window_start) rather than sharing this table's rows --
  // that feature's input is unbounded (whole repos), so it keeps its
  // own much larger per-window cap and its own counter, even though
  // both now reset on the same clock.
  //
  // window_start is the fixed-size bucket (AI_USAGE_WINDOW_HOURS,
  // 5 hours by default) a call's timestamp falls into -- anchored to
  // the Unix epoch, not the local calendar day (see
  // lib/billing/ai-usage.ts's currentWindowStart doc comment for why
  // the shipped 5-hour default doesn't reset at the same UTC clock
  // time every day the way a divisor of 24 like 6 or 12 would). A
  // FIXED window either way, not the rolling window VulnRadar's own
  // hosted AI provider (MiniMax's Token Plan quota) uses -- simpler to
  // implement and reason about correctly than a rolling window.
  //
  // tokens_used accumulates the REAL usage the AI provider reports per
  // call where available, falling back to a character-length estimate
  // only for the one call shape that can't easily get real numbers
  // (the AI chat SSE stream on a provider that doesn't return a usage
  // chunk) -- see lib/billing/ai-usage.ts and the doc comments in
  // app/api/v3/ai/chat/route.ts.
  //
  // No id column: (user_id, window_start) is naturally unique (one
  // counter per user per window) and is exactly the lookup every
  // caller needs, so it's the primary key directly rather than a
  // surrogate id plus a separate UNIQUE constraint.
  //
  // Only ever incremented when the user is calling with VulnRadar's
  // own AI (use_vulnradar_ai = true in user_ai_configs); a user
  // calling with their own AI provider key bypasses this table
  // entirely (see lib/billing/ai-usage.ts's hasOwnAiConfig reuse),
  // since VulnRadar isn't paying for those AI calls.
  // ════════════════════════════════════════════════════════════════
  {
    id: "ai-usage",
    onError: "warn",
    warning: "Failed to create/verify ai_usage",
    sql: `
        CREATE TABLE IF NOT EXISTS ai_usage (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          window_start TIMESTAMPTZ NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, window_start)
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AUTO TAGS - scan_tags predates this column (v1 baseline): every
  // existing row is a user-typed free-form tag added from the history
  // page. `source` distinguishes those from tags lib/tags/auto-tags.ts
  // derives deterministically from a scan's own findings (category/CWE
  // + severity rules -> short labels like "Secrets Exposed", "XSS
  // Risk") and saves at scan-completion time. Defaults to 'user' so
  // every pre-existing row keeps its current meaning without a
  // backfill. The two tag spaces never collide on the UNIQUE(scan_id,
  // tag) constraint below: user tags are always lowercased before
  // insert (app/api/v3/scan/tags/route.ts) while every auto-tag label
  // is Title Case, so the same scan can hold both "secrets" (user) and
  // "Secrets Exposed" (auto) without a conflict.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-tags-source",
    onError: "warn",
    warning: "Failed to add scan_tags.source",
    sql: `
        ALTER TABLE scan_tags
          ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'user'
            CHECK (source IN ('auto', 'user', 'ai'));
    `,
  },

  // scan_tags_source_check was created above with only ('auto', 'user')
  // allowed -- ADD COLUMN IF NOT EXISTS is a no-op on an already-
  // deployed column, so widening the CHECK in the statement above alone
  // never reaches an existing installation. lib/tags/auto-tags.ts's
  // maybeSuggestAiTag has been writing source='ai' since the AI tag
  // suggestion feature shipped; every one of those INSERTs was silently
  // failing the constraint and getting swallowed by that function's own
  // non-fatal catch (visible only as a "violates check constraint
  // scan_tags_source_check" log line, never surfaced to a user). Drop
  // and recreate is the only way Postgres lets you widen a CHECK.
  {
    id: "scan-tags-source-check-widen",
    onError: "warn",
    warning: "Failed to widen scan_tags_source_check",
    sql: `
        ALTER TABLE scan_tags DROP CONSTRAINT IF EXISTS scan_tags_source_check;
        ALTER TABLE scan_tags ADD CONSTRAINT scan_tags_source_check
          CHECK (source IN ('auto', 'user', 'ai'));
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AUTO TAG DISMISSALS - a user telling us one specific auto tag
  // (source = 'auto' in scan_tags above) was wrong on one specific
  // scan. Dismissing removes the row from scan_tags (same viewer-facing
  // effect as deleting a user tag, see app/api/v3/scan/tags/route.ts's
  // "remove" branch) but this table durably logs that it happened, so
  // Admin > Engine Feedback (app/api/v3/admin/engine-feedback/tags/
  // route.ts) can aggregate, per auto-tag rule, how often real users
  // tell it it's wrong -- a signal for a human to retune
  // lib/tags/auto-tags.ts's rules, never applied automatically.
  // `tag` is enough to identify which AUTO_TAG_RULES entry fired: every
  // rule produces a distinct tag string. UNIQUE(scan_id, tag) is a
  // belt-and-suspenders guard (the app already no-ops a retry via
  // ON CONFLICT), since the row it would log has already been deleted
  // from scan_tags by the first successful dismissal.
  // ════════════════════════════════════════════════════════════════
  {
    id: "auto-tag-dismissals",
    onError: "warn",
    warning: "Failed to create/verify auto_tag_dismissals",
    sql: `
        CREATE TABLE IF NOT EXISTS auto_tag_dismissals (
          id SERIAL PRIMARY KEY,
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          tag VARCHAR(50) NOT NULL,
          dismissed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(scan_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_auto_tag_dismissals_tag ON auto_tag_dismissals(tag);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PUBLIC SCANS DIRECTORY - share_publicly_listed / (users)
  // share_publicly_listed_by_default. A NEW, independent privacy
  // mechanism from scan_history.is_public above -- that flag gates the
  // per-host public cache at /host/[hostname] and is untouched by this
  // feature. This one gates the unauthenticated, browsable /public-scans
  // directory (app/api/v3/public-scans/route.ts, app/public-scans/
  // page.tsx): a share only shows up there when its own
  // share_publicly_listed is true AND it still has a live share_token.
  //
  // share_publicly_listed is only meaningful once share_token is set --
  // decided exactly once, at the moment a NEW share link is created
  // (see lib/scanner/share-privacy.ts's resolveSharePubliclyListed and
  // app/api/v3/history/[id]/share/route.ts's POST handler), by the same
  // "explicit per-call value wins, else the account default" shape as
  // resolveScanIsPublic/scans_private_by_default above. From there a
  // user can flip a single share's listing on/off from the Shared page
  // (PUT /api/v3/history/[id]/share/publicly-listed) independent of the
  // account default.
  //
  // users.share_publicly_listed_by_default defaults to true (unlike
  // scans_private_by_default's false) per the product decision for
  // this feature: a NEW share's listing is on unless a user turns it
  // off, either at the account level or per share.
  //
  // scan_history.share_publicly_listed itself defaults to FALSE, a
  // deliberately different choice: ADD COLUMN backfills every EXISTING
  // row, including scans shared under the old, pre-directory
  // link-only model, long before /public-scans existed. DEFAULT true
  // here would silently publish every one of those the instant this
  // runs, with no re-consent. The app never relies on this column's
  // default for a real share -- share/route.ts's POST handler always
  // writes share_publicly_listed explicitly -- so DEFAULT false only
  // ever affects rows this backfill touches, never a share created
  // through the app.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history-share-publicly-listed",
    onError: "warn",
    warning: "Failed to add scan_history.share_publicly_listed",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_publicly_listed BOOLEAN NOT NULL DEFAULT false;
    `,
  },

  {
    id: "users-share-publicly-listed-by-default",
    onError: "warn",
    warning: "Failed to add users.share_publicly_listed_by_default",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS share_publicly_listed_by_default BOOLEAN NOT NULL DEFAULT true;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // OPAQUE SCAN IDS - scan_history.public_id
  //
  // Scan history was addressed by the sequential SERIAL primary key
  // (?scan=456, /api/v3/history/456), which is trivially enumerable.
  // public_id is an opaque, non-sequential handle the URLs and API now
  // resolve by instead (see lib/history/resolve-scan.ts); the numeric
  // id stays the real primary key -- four foreign keys still reference
  // it (scan_tags.scan_id, scan_finding_feedback.scan_history_id,
  // host_reputation.source_scan_id, auto_tag_dismissals.scan_id) -- so
  // nothing about the PK type or those relationships changes.
  //
  // The DEFAULT does double duty, exactly like webhooks.secret above:
  // it fills every NEW row with its own value (no insert site has to
  // set it), and because gen_random_uuid() is volatile, ADD COLUMN
  // rewrites the table and evaluates it once PER existing row, so every
  // pre-existing scan is back-filled with its own distinct value in the
  // same statement. A single gen_random_uuid() with its hyphens
  // stripped is 32 hex chars (128 bits) -- URL-safe and not guessable.
  // The extra UPDATE is a belt-and-suspenders backfill for any row a
  // prior partial run could have left with a NULL public_id, and the
  // UNIQUE index enforces non-collision. All three steps are idempotent
  // (IF NOT EXISTS / WHERE public_id IS NULL) so re-running boot is safe.
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history-public-id",
    onError: "warn",
    warning: "Failed to add scan_history.public_id",
    sql: `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS public_id TEXT
            DEFAULT (replace(gen_random_uuid()::text, '-', ''));
        UPDATE scan_history
          SET public_id = replace(gen_random_uuid()::text, '-', '')
          WHERE public_id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_history_public_id
          ON scan_history(public_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // STAFF PLAN GRANT/REVOKE - users.pre_staff_plan
  //
  // Staff (admin/moderator/support) used to bypass every quota
  // entirely (see lib/rate-limiting/daily-limits.ts /
  // lib/billing/plan-limits.ts, which still resolve a staff caller to
  // the Pro Supporter plan's numeric limits as a safety net). On top
  // of that, a staff role change now writes a REAL, non-Stripe
  // `users.plan` change (see lib/billing/staff-plan.ts, called from
  // the role-change handlers in app/api/v3/admin/route.ts): promotion
  // to staff bumps a free/core_supporter/pro_supporter account to
  // pro_supporter for real, remembering the prior plan in
  // pre_staff_plan (only the first time) so losing staff instantly
  // restores it. An account already above Pro (elite_supporter) when
  // promoted keeps it untouched and pre_staff_plan stays NULL.
  //
  // The UPDATE below backfills every EXISTING staff account the same
  // way on boot, since adding the column alone only affects FUTURE
  // role changes. Guarded by pre_staff_plan IS NULL so this is a
  // no-op after the first run. super_admin is deliberately excluded,
  // matching STAFF_ROLES in lib/rate-limiting/daily-limits.ts -- it's
  // un-assignable through the admin panel.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here
  // too so an already-running v3+ deployment picks this up on its
  // next restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-pre-staff-plan",
    onError: "warn",
    warning: "Failed to add/backfill users.pre_staff_plan",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS pre_staff_plan VARCHAR(50);
        UPDATE users
          SET pre_staff_plan = COALESCE(plan, 'free'), plan = 'pro_supporter'
          WHERE role IN ('admin', 'moderator', 'support')
            AND COALESCE(plan, 'free') IN ('free', 'core_supporter', 'pro_supporter')
            AND pre_staff_plan IS NULL;
    `,
  },

  // Billing interval ('month' | 'year') of the user's active Stripe
  // subscription, written alongside plan/status by the webhook and
  // confirmSubscription. NULL for free/staff/never-subscribed accounts.
  // The admin MRR estimate reads it to amortize yearly subs (charged the
  // discounted annual price up front) instead of counting them at the full
  // monthly price. Existing subs backfill on their next Stripe event.
  {
    id: "users-billing-interval",
    onError: "warn",
    warning: "Failed to add users.billing_interval",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(10);
    `,
  },

  // ── Staff plan reconciliation ───────────────────────────────────
  // Self-heals any staff role assigned by directly editing users.role
  // in the database (e.g. hand-run SQL to grant super_admin on an
  // existing account) -- see lib/billing/staff-plan.ts's
  // reconcileStaffPlans for why that bypasses the real plan grant.
  // Runs every boot; fully idempotent/no-op once already reconciled.

  // ════════════════════════════════════════════════════════════════
  // ONE-TIME AI CREDIT PURCHASES - users.ai_credit_balance
  //
  // A purchased AI verification token balance, bought via a real
  // one-time Stripe PaymentIntent (mode: "payment", never
  // "subscription" -- see app/actions/stripe.ts's
  // createAiCreditPaymentIntent and lib/billing/ai-credit-catalog.ts's
  // tier list), confirmed through Stripe Elements on
  // app/checkout/credits/page.tsx, and credited once payment clears
  // (see lib/billing/ai-usage.ts's creditAiCreditPurchase, called from
  // both confirmAiCreditPurchase and the webhook's
  // payment_intent.succeeded handler -- see the ai_credit_purchases
  // table below for how the two are kept from double-crediting the
  // same purchase). Unlike the ai_usage window counter above, this is
  // NEVER reset by the window -- lib/billing/ai-usage.ts's
  // recordAiTokens spends from it only as a fallback once the plan's
  // free aiTokensPerWindow allowance is exhausted for the current
  // window, so a purchase is a durable top-up, not another per-window
  // allowance.
  //
  // A single BIGINT column, not a ledger table: every credit and
  // every spend is a single atomic UPDATE (a plain `+` on credit,
  // a `GREATEST(..., 0)` floor on spend), so the running balance
  // stays correct under concurrent AI verification calls without
  // needing a transaction or row-level locking. processed_stripe_events
  // (already created above) is what keeps a replayed DELIVERY of the
  // same webhook event from crediting twice.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here
  // too so an already-running v3+ deployment picks this up on its
  // next restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-ai-credit-balance",
    onError: "warn",
    warning: "Failed to add users.ai_credit_balance",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS ai_credit_balance BIGINT NOT NULL DEFAULT 0;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ONE-TIME GITHUB REVIEW CREDIT PURCHASES - users.github_credit_balance
  //
  // Same shape as users.ai_credit_balance above, for a completely
  // separate balance: a purchased GitHub repo AI review token top-up
  // (lib/billing/github-credit-catalog.ts's tier list, bought via
  // app/actions/stripe.ts's createGithubCreditPaymentIntent), spent
  // only as a fallback once the plan's free githubReviewTokensPerWindow
  // allowance is exhausted for the current window (see
  // lib/billing/github-review-usage.ts's recordGithubReviewTokens).
  // Never reset by the window -- a purchase is a durable top-up, not
  // another per-window allowance.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-github-credit-balance",
    onError: "warn",
    warning: "Failed to add users.github_credit_balance",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS github_credit_balance BIGINT NOT NULL DEFAULT 0;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // FREE GITHUB AI REVIEW TRIAL - users.free_github_review_used_at
  //
  // A hidden taste-then-upsell mechanic for any plan whose
  // githubReviewTokensPerWindow is 0 (currently just Free): one GitHub
  // AI code review every 24 hours, layered in front of the real
  // (zero) per-window token quota rather than replacing it -- see
  // lib/billing/github-review-usage.ts's hasUsedFreeGithubReviewToday/
  // markFreeGithubReviewUsed. Deliberately NOT part of the
  // PlanLimits/catalog.ts system: it never appears on the pricing
  // page (catalog.ts's free.limits.githubReviewTokensPerWindow stays
  // 0), it's a quiet trial, not a real entitlement.
  //
  // Nullable, no default: NULL means "never used the trial."
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-free-github-review-used-at",
    onError: "warn",
    warning: "Failed to add users.free_github_review_used_at",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS free_github_review_used_at TIMESTAMPTZ;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ACCOUNT DELETION FK FIX - broadcast_messages.created_by
  //
  // Created NOT NULL with no ON DELETE clause (default RESTRICT), so
  // deleting any staff account that ever created a broadcast message
  // (admin-initiated OR self-service) threw an unhandled foreign-key
  // violation. Every other user-referencing column the delete path
  // touches (admin_audit_log.target_user_id, security_alerts.
  // resolved_by, system_settings.updated_by) already tolerates this
  // via nullability + ON DELETE SET NULL -- bring this one in line.
  // Both statements are idempotent: DROP CONSTRAINT IF EXISTS no-ops
  // once already dropped, and re-adding the same constraint name with
  // the same definition on every boot is harmless.
  // ════════════════════════════════════════════════════════════════
  {
    id: "broadcast-messages-created-by-nullable",
    onError: "warn",
    warning: "Failed to drop NOT NULL on broadcast_messages.created_by",
    sql: `ALTER TABLE broadcast_messages ALTER COLUMN created_by DROP NOT NULL;
    `,
  },

  {
    id: "broadcast-messages-created-by-fk",
    onError: "warn",
    warning:
      "Failed to widen broadcast_messages.created_by FK to ON DELETE SET NULL",
    sql: `
        ALTER TABLE broadcast_messages
          DROP CONSTRAINT IF EXISTS broadcast_messages_created_by_fkey;
        ALTER TABLE broadcast_messages
          ADD CONSTRAINT broadcast_messages_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PROMOTED AUTO-TAG RULES - promoted_auto_tag_rules
  //
  // The admin-facing half of the layered auto-tag design (see
  // lib/tags/auto-tags.ts and lib/ai/auto-tag-suggest.ts's own
  // comments). lib/tags/auto-tags.ts's ~50 hardcoded AUTO_TAG_RULES
  // stay the fast, code-reviewed baseline; for a scan whose findings
  // match none of them, lib/ai/auto-tag-suggest.ts generates 1-2
  // specific tag names on the fly and saves them with `source = 'ai'`
  // in scan_tags instead of the generic "Needs Hardening" fallback
  // alone. Admin > Engine Feedback's "AI Tag Candidates" panel
  // aggregates which of those AI tags keep recurring across distinct
  // scans, and a "Promote" action there inserts a row here: the same
  // cwes/categories/requireBoth/minSeverity/minCount shape as the
  // hardcoded AutoTagRule type (cwes/categories as JSONB string
  // arrays), so computeAutoTags can merge it in as a real,
  // deterministic rule -- no more AI calls needed for that concept,
  // and no deploy needed either. `tag` is UNIQUE (promoting the same
  // AI-suggested text twice would otherwise double the rule), and the
  // CHECK guards against a rule with neither cwes nor categories set
  // (nothing for it to ever match).
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here
  // too so an already-running v3+ deployment picks this up on its
  // next restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "promoted-auto-tag-rules",
    onError: "warn",
    warning: "Failed to create/verify promoted_auto_tag_rules",
    sql: `
        CREATE TABLE IF NOT EXISTS promoted_auto_tag_rules (
          id SERIAL PRIMARY KEY,
          tag VARCHAR(50) NOT NULL UNIQUE,
          cwes JSONB,
          categories JSONB,
          require_both BOOLEAN NOT NULL DEFAULT FALSE,
          min_severity VARCHAR(10) NOT NULL
            CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical')),
          min_count INTEGER NOT NULL DEFAULT 1,
          source_ai_tag VARCHAR(50),
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (cwes IS NOT NULL OR categories IS NOT NULL)
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AI CREDIT PURCHASE IDEMPOTENCY LEDGER - ai_credit_purchases
  //
  // A one-time AI credit purchase (users.ai_credit_balance above) can
  // now be credited by either of TWO independent code paths: the
  // fast/primary path (app/actions/stripe.ts's confirmAiCreditPurchase,
  // called the instant the client confirms payment on
  // app/checkout/credits/page.tsx) or the Stripe webhook's
  // payment_intent.succeeded handler (the backup path for a closed tab
  // / lost connection). Crediting the balance is a running `+` (see
  // lib/billing/ai-usage.ts's addAiCreditBalance), NOT idempotent the
  // way the subscription flow's plan UPDATE is, so both paths reaching
  // it for the same PaymentIntent would double-credit the user --
  // processed_stripe_events only dedupes a REPEATED DELIVERY of the
  // same webhook event, it does nothing to stop these two DIFFERENT
  // code paths from each crediting once.
  //
  // payment_intent_id is the real guard, PRIMARY KEY so a second
  // INSERT for the same id is rejected via ON CONFLICT DO NOTHING --
  // see lib/billing/ai-usage.ts's creditAiCreditPurchase, the single
  // shared function both callers go through: it inserts here BEFORE
  // calling addAiCreditBalance, and only calls it when the insert
  // actually happened.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here
  // too so an already-running v3+ deployment picks this up on its
  // next restart without an explicit `npm run db:migrate`.
  // ════════════════════════════════════════════════════════════════
  {
    id: "ai-credit-purchases",
    onError: "warn",
    warning: "Failed to create/verify ai_credit_purchases",
    sql: `
        CREATE TABLE IF NOT EXISTS ai_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tokens BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GITHUB CREDIT PURCHASE IDEMPOTENCY LEDGER - github_credit_purchases
  //
  // Same shape and same reason as ai_credit_purchases above, for the
  // GitHub review credit balance instead: two independent code paths
  // (app/actions/stripe.ts's confirmGithubCreditPurchase, the fast
  // path, and the Stripe webhook's payment_intent.succeeded handler,
  // the backup path) can each try to credit the same successful
  // PaymentIntent, and crediting the balance is a running `+`, not
  // idempotent on its own. payment_intent_id PRIMARY KEY is the real
  // guard -- see lib/billing/github-review-usage.ts's
  // creditGithubCreditPurchase, the single shared function both
  // callers go through.
  // ════════════════════════════════════════════════════════════════
  {
    id: "github-credit-purchases",
    onError: "warn",
    warning: "Failed to create/verify github_credit_purchases",
    sql: `
        CREATE TABLE IF NOT EXISTS github_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tokens BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BROWSERBASE MINUTE USAGE + ONE-TIME CREDIT PURCHASES
  //
  // browserbaseMinutesPerMonth plan limit (see
  // lib/billing/browserbase-usage.ts): a calendar-month counter table
  // (browserbase_usage, same shape as ai_usage above but bucketed by
  // month instead of a fixed-hour window) plus a purchased top-up
  // balance (users.browserbase_credit_seconds_balance) bought via a
  // real one-time Stripe PaymentIntent (mode: "payment" -- see
  // app/actions/stripe.ts's createBrowserbaseCreditPaymentIntent and
  // lib/billing/browserbase-credit-catalog.ts's tier list), confirmed
  // through Stripe Elements on
  // app/checkout/browser-credits/page.tsx. browserbase_credit_purchases
  // is the same payment_intent_id-keyed idempotency ledger as
  // ai_credit_purchases/github_credit_purchases above, guarding against
  // the fast-path confirm action and the webhook's
  // payment_intent.succeeded handler each trying to credit the same
  // successful purchase.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users-browserbase-credit-seconds-balance",
    onError: "warn",
    warning: "Failed to add users.browserbase_credit_seconds_balance",
    sql: `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS browserbase_credit_seconds_balance BIGINT NOT NULL DEFAULT 0;
    `,
  },

  {
    id: "browserbase-usage",
    onError: "warn",
    warning: "Failed to create/verify browserbase_usage",
    sql: `
        CREATE TABLE IF NOT EXISTS browserbase_usage (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          period_start TIMESTAMPTZ NOT NULL,
          seconds_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, period_start)
        );
    `,
  },

  {
    id: "browserbase-credit-purchases",
    onError: "warn",
    warning: "Failed to create/verify browserbase_credit_purchases",
    sql: `
        CREATE TABLE IF NOT EXISTS browserbase_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          seconds BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // refunded_at: set when a Stripe charge.refunded / charge.dispute.created
  // for the purchase's PaymentIntent claws the credit back (see the Stripe
  // webhook's reverse*CreditPurchase calls). NULL-guarded so a reversal
  // runs at most once per purchase even if both a dispute and a later
  // refund fire.
  {
    id: "credit-purchases-refunded-at",
    onError: "warn",
    warning: "Failed to add refunded_at to credit purchase ledgers",
    sql: `
        ALTER TABLE ai_credit_purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
        ALTER TABLE github_credit_purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
        ALTER TABLE browserbase_credit_purchases ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
    `,
  },

  // Consecutive-failure streak per background worker, persisted so a worker
  // that crash-loops (a fresh process every tick) still accumulates toward
  // the admin-alert threshold instead of resetting its in-memory counter to
  // zero on every boot. See lib/admin/failure-escalation.ts.
  {
    id: "worker-failure-state",
    onError: "warn",
    warning: "Failed to create/verify worker_failure_state",
    sql: `
        CREATE TABLE IF NOT EXISTS worker_failure_state (
          event VARCHAR(100) PRIMARY KEY,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          alerted BOOLEAN NOT NULL DEFAULT false,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DOMAIN OWNERSHIP VERIFICATION - domains
  //
  // DNS TXT-based proof of control over a domain (see
  // lib/domains/verification.ts), the prerequisite intrusive active
  // probing checks against (see lib/domains/scope.ts, enforced in
  // app/api/v3/scan/route.ts and app/api/v3/scan/crawl/route.ts):
  // active-probes submits real exploit-attempt payloads to the target,
  // and must never run against a URL the caller hasn't proven control
  // over. UNIQUE(user_id, domain) rather than a globally-unique domain
  // column deliberately: two different users can each hold their own
  // pending row for the same domain (e.g. one no longer controls DNS,
  // the other genuinely does now) -- only whoever can actually place
  // their own row's distinct verification_token in DNS ever reaches
  // 'verified'. status can also be 'reverify_failed' (was verified,
  // the periodic re-check -- lib/domains/reverify-worker.ts -- no
  // longer finds the token): scope checks only ever treat 'verified'
  // as usable, so this alone revokes access without a separate delete.
  // ════════════════════════════════════════════════════════════════
  {
    id: "domains",
    onError: "warn",
    warning: "Failed to create/verify domains",
    sql: `
        CREATE TABLE IF NOT EXISTS domains (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
          domain VARCHAR(255) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          verification_token VARCHAR(64) NOT NULL,
          verification_method VARCHAR(20) NOT NULL DEFAULT 'dns_txt',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          verified_at TIMESTAMPTZ,
          last_checked_at TIMESTAMPTZ,
          last_check_error TEXT,
          UNIQUE(user_id, domain)
        );
        CREATE INDEX IF NOT EXISTS idx_domains_team_id ON domains(team_id) WHERE team_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_domains_domain_verified ON domains(domain) WHERE status = 'verified';
    `,
  },
];
