/**
 * VulnRadar boot schema, part 3 of 4: embeddable badges, support tickets,
 * module-owned DDL, and the indexes that have to wait for them.
 *
 * The last group of tables, plus the foreign-key indexes that could not go in
 * part 2 because their tables are created here. A multi-statement query runs
 * as one implicit transaction, so a CREATE INDEX naming a table that does not
 * exist yet would roll back every other index in the same call.
 */

/** @type {import("./index.mjs").SchemaStep[]} */
export const integrationSchemaSteps = [
  // ── Run initial cleanup ───────────────────────────────────────

  // ── Schedule periodic cleanup ─────────────────────────────────
  // In-process cleanup runs every 5 minutes. The shortest
  // meaningful user-facing TTL is email_2fa_codes (10 min), so 5
  // min cadence keeps stale entries from lingering more than
  // halfway through their next scheduled run. The in-process
  // setInterval only fires in long-lived deployments (Node,
  // Docker, self-hosted); for serverless deployments the cleanup
  // job won't run — accept that limitation. Staff can also force
  // a run from the admin UI: POST /api/v3/admin/cleanup.

  // ── Schedule the scheduled-scans worker ──────────────────────
  // Polls scheduled_scans for anything due every
  // CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS (2 min by default) rather
  // than trying to align exactly with each schedule's own frequency --
  // same "poll on a short fixed cadence, not per-row timers" approach
  // as the cleanup job above. See lib/scanner/scheduled-scans-worker.ts
  // for the claim/concurrency/notification design.

  // ── Posture digest: schema + periodic worker ──────────────────
  // ensureDigestSchema() adds users.digest_email_enabled/
  // last_digest_sent_at and notification_preferences.email_posture_digest
  // (additive, self-healing) before the worker's first poll tick can
  // reference them. See lib/notifications/posture-digest.ts.

  // ── Periodic domain re-verification ──────────────────────────────
  // On by default (DOMAIN_REVERIFY_ENABLED, see registry.ts) -- a
  // safety mechanism, not an opt-in convenience feature, unlike the
  // scheduled-backup worker below. Closes the gap where a verified
  // domain that later changes hands keeps the original account's
  // active-probes permission forever. See lib/domains/reverify-worker.ts.

  // ── Scheduled database backups ──────────────────────────────────
  // Off by default (SCHEDULED_BACKUP_ENABLED, see registry.ts) -- the
  // timer is always registered so flipping the setting on takes effect
  // on the next tick without a restart, same as posture digests above.
  // See lib/backup/scheduled-backup-worker.ts.

  // ════════════════════════════════════════════════════════════════
  // HOST BADGES - stable per-user-per-URL token for the "Secured by
  // VulnRadar" embeddable badge (app/badge/page.tsx), so a badge
  // embedded once on an external site keeps showing that URL's LATEST
  // completed scan by date -- never a best-ever result -- without the
  // owner ever touching the embed code again. Distinct from
  // scan_history.share_token, which pins a badge/share link to one
  // specific scan forever; a host_badges token instead resolves, on
  // every image request, to whichever scan_history row for
  // (user_id, url) has the newest scanned_at. See
  // app/api/v3/badge/[token]/route.ts, which tries a share_token_hash
  // match first (unchanged, for badges/links issued before this
  // feature existed) and falls back to badge_token_hash.
  //
  // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here
  // too so a fresh `docker compose up` gets this table without an
  // explicit `npm run db:migrate` -- every other v3+ table follows the
  // same auto-create-on-boot + explicit-migration dual path.
  // ════════════════════════════════════════════════════════════════
  {
    id: "host-badges",
    onError: "warn",
    warning: "Failed to create/verify host_badges",
    sql: `
        CREATE TABLE IF NOT EXISTS host_badges (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          badge_token TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_host_badges_user_url
          ON host_badges (user_id, url);
    `,
  },

  // badge_token_hash is a generated column -- separate statement, same
  // reason as scan_history.share_token_hash above (PostgreSQL disallows
  // mixing generated and regular columns in one ALTER, and IF NOT
  // EXISTS is unsupported for generated columns on older PG versions).
  {
    id: "host-badges-badge-token-hash",
    onError: "ignore",
    sql: `
        ALTER TABLE host_badges
          ADD COLUMN IF NOT EXISTS badge_token_hash TEXT
          GENERATED ALWAYS AS (encode(sha256(badge_token::bytea), 'hex')) STORED;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_host_badges_token_hash
          ON host_badges(badge_token_hash);
    `,
  },

  // scope controls whose scans a badge resolves against: 'user' (the
  // default, matching the original behavior) only ever shows the badge
  // owner's own scans of that URL; 'global' shows whichever completed
  // scan of that URL is newest, by anyone. Owner-toggleable, off by
  // default so a badge never starts pulling in a stranger's scan data
  // without the owner opting in. See app/api/v3/badge/[token]/route.ts
  // and app/api/v3/shared/[token]/route.ts for how the JOIN branches on
  // this, and app/api/v3/badge/site/route.ts's PATCH handler for the
  // toggle itself.
  {
    id: "host-badges-scope",
    onError: "warn",
    warning: "Failed to add host_badges.scope",
    sql: `
        ALTER TABLE host_badges
          ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user'
          CHECK (scope IN ('user', 'global'));
    `,
  },

  // In-app support tickets: a two-way thread between a user (any plan,
  // including free) and staff, for billing/scanning/account questions.
  // support_tickets is the thread header; support_ticket_messages holds
  // each reply. author_user_id is SET NULL (not CASCADE) so a message
  // survives the author's account deletion for the other party's record,
  // while a whole ticket CASCADE-deletes with its owner.
  {
    id: "support-tickets",
    onError: "warn",
    warning: "Failed to create/verify support ticket tables",
    sql: `
        CREATE TABLE IF NOT EXISTS support_tickets (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          subject VARCHAR(200) NOT NULL,
          category VARCHAR(20) NOT NULL DEFAULT 'other'
            CHECK (category IN ('billing', 'scanning', 'account', 'other')),
          status VARCHAR(20) NOT NULL DEFAULT 'open'
            CHECK (status IN ('open', 'awaiting_staff', 'awaiting_user', 'resolved', 'closed')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_support_tickets_user
          ON support_tickets(user_id, last_message_at DESC);
        CREATE INDEX IF NOT EXISTS idx_support_tickets_status
          ON support_tickets(status, last_message_at DESC);
        CREATE TABLE IF NOT EXISTS support_ticket_messages (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          is_staff BOOLEAN NOT NULL DEFAULT FALSE,
          body TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
          ON support_ticket_messages(ticket_id, created_at);
        -- Owner-granted, per-user collaboration: a ticket owner can share a
        -- ticket with SPECIFIC teammates (users who share a team with them),
        -- never the whole team automatically. Shared users can read and reply,
        -- but only the owner (or staff) changes status or manages shares.
        CREATE TABLE IF NOT EXISTS support_ticket_shares (
          ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
          shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (ticket_id, shared_with_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_support_ticket_shares_user
          ON support_ticket_shares(shared_with_user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // STAFF INVITES + ADMIN AUDIT LOG ARCHIVE + POSTURE DIGEST COLUMNS
  //
  // Three pieces of DDL that live in a helper module rather than here.
  // staff_invites and admin_audit_log_archive used to exist only as lazy
  // runtime DDL (AUDIT-013 schema-02) and were wired into the boot path; the
  // posture-digest columns were never wired into anything but the boot path at
  // all, so users.digest_email_enabled, users.last_digest_sent_at and
  // notification_preferences.email_posture_digest existed on a booted database
  // and on no other path.
  //
  // Each of those modules stays the owner of its own DDL (each has its own
  // unit test asserting exactly what it runs), so these are moduleSource
  // steps: the boot path calls the module's ensure*() helper, and a path that
  // cannot import TypeScript reads the DDL out of the same file. What changed
  // is that they are STEPS IN THIS ORDERED LIST rather than DDL appended after
  // everything else. Appending is what made npm run db:create execute
  // "CREATE INDEX ... ON staff_invites" (the late-index step below) before
  // "CREATE TABLE staff_invites", then swallow the failure as a warning and
  // leave the index absent.
  {
    id: "staff-invites",
    moduleSource: "lib/admin/staff-invites.ts",
    onError: "warn",
    warning: "Failed to create/verify staff_invites",
  },
  {
    id: "admin-audit-log-archive",
    moduleSource: "lib/database/audit-log-archive.ts",
    onError: "warn",
    warning: "Failed to create/verify admin_audit_log_archive",
  },
  {
    id: "posture-digest-columns",
    moduleSource: "lib/notifications/digest-schema.ts",
    onError: "warn",
    warning: "Failed to add the posture-digest columns",
  },

  // ════════════════════════════════════════════════════════════════
  // STAFF INVITES + ADMIN AUDIT LOG ARCHIVE (AUDIT-013 schema-02)
  //
  // Both tables used to exist only as lazy runtime DDL: staff_invites
  // was created by ensureStaffInvitesTable() on every single GET/POST/
  // DELETE to /api/v3/admin/staff-invites, and admin_audit_log_archive
  // by ensureAuditLogArchiveTable() from inside the nightly cleanup
  // transaction. Neither appeared in this file, in scripts/migrate/ or
  // in scripts/create-fresh-db/, so `npm run db:create` and
  // `npm run db:migrate` both produced a database missing them and the
  // health check reported a healthy schema. Both modules' own doc
  // comments asked for exactly this call site; this is it. The ensure*
  // helpers stay (they are idempotent and their tests cover them), but
  // the schema no longer depends on a request happening to run first.
  // ════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════
  // WEBHOOK SIGNING SECRETS (AUDIT-009 webhook-01)
  //
  // webhooks.secret was the only long-lived reversible secret still
  // stored in plaintext, so this backfills existing rows to the same
  // AES-256-GCM form every other secret uses. Idempotent, and it runs
  // here rather than next to the TOTP/Discord backfill at the top of
  // register() because that one runs before any CREATE TABLE, and the
  // webhooks table has to exist first. A row that is ciphertext under a
  // key we no longer hold is reported and left alone, never rewritten.
  // ════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════
  // LATE INDEXES + FOREIGN-KEY DELETE BEHAVIOUR
  //
  // The rest of the AUDIT-012 perf-15 / AUDIT-013 schema-03 index set.
  // These live here rather than in the block further up because their
  // tables are created after it: a multi-statement pool.query runs as
  // one implicit transaction, so a CREATE INDEX on a table that does
  // not exist yet would roll back every other index in the same call.
  // ════════════════════════════════════════════════════════════════
  {
    id: "late-foreign-key-indexes",
    onError: "warn",
    warning: "Failed to create late foreign-key indexes",
    sql: `
        CREATE INDEX IF NOT EXISTS idx_user_notifications_created
          ON user_notifications(created_at);
        CREATE INDEX IF NOT EXISTS idx_gru_updated
          ON github_review_usage(updated_at);
        CREATE INDEX IF NOT EXISTS idx_auto_tag_dismissals_scan_id
          ON auto_tag_dismissals(scan_id);
        CREATE INDEX IF NOT EXISTS idx_auto_tag_dismissals_dismissed_by
          ON auto_tag_dismissals(dismissed_by_user_id)
          WHERE dismissed_by_user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_promoted_auto_tag_rules_created_by
          ON promoted_auto_tag_rules(created_by) WHERE created_by IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_ai_credit_purchases_user_id
          ON ai_credit_purchases(user_id);
        CREATE INDEX IF NOT EXISTS idx_github_credit_purchases_user_id
          ON github_credit_purchases(user_id);
        CREATE INDEX IF NOT EXISTS idx_browserbase_credit_purchases_user_id
          ON browserbase_credit_purchases(user_id);
        CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_author
          ON support_ticket_messages(author_user_id)
          WHERE author_user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_support_ticket_shares_shared_by
          ON support_ticket_shares(shared_by_user_id)
          WHERE shared_by_user_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_staff_invites_invited_by
          ON staff_invites(invited_by);
        CREATE INDEX IF NOT EXISTS idx_broadcast_messages_sent_by
          ON broadcast_messages(sent_by) WHERE sent_by IS NOT NULL;
    `,
  },
];
