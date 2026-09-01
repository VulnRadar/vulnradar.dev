/**
 * VulnRadar boot schema, part 1 of 4: the core tables.
 *
 * Everything an install has had since the v1/v2 baseline: identity and
 * sessions, scanning, billing, the admin surfaces, teams and messaging. These
 * run first because almost every later step references users(id) or
 * scan_history(id).
 *
 * Most steps here take the default onError, "throw": a failure means the
 * database is unusable, and register() aborts the boot rather than serving
 * traffic against it. Every statement is unchanged from the single boot-time
 * block this was split out of; see ./index.mjs for why it moved.
 */

/** @type {import("./index.mjs").SchemaStep[]} */
export const coreSchemaSteps = [
  // ════════════════════════════════════════════════════════════════
  // USERS - The central table. Contains ALL user data.
  // ════════════════════════════════════════════════════════════════
  {
    id: "users",
    sql: `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          
          -- Core identity
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          avatar_url TEXT,
          discord_id VARCHAR(64) UNIQUE,
          
          -- Role & permissions (simple string, not FK)
          -- Values: 'user', 'beta_tester', 'support', 'moderator', 'admin'
          role VARCHAR(20) NOT NULL DEFAULT 'user',
          
          -- Subscription & billing (previously separate table)
          plan VARCHAR(50) NOT NULL DEFAULT 'free',
          stripe_customer_id VARCHAR(255) UNIQUE,
          stripe_subscription_id VARCHAR(255) UNIQUE,
          subscription_status VARCHAR(50) DEFAULT NULL,
          current_period_end TIMESTAMP WITH TIME ZONE,
          cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
          
          -- Feature flags
          -- AUDIT-011#drift-17: both of these are half-built, not wired.
          -- beta_access is hardcoded false by every INSERT (lib/auth/auth.ts,
          -- the staff-invite signup) with no UPDATE and no gate reading it,
          -- so the "beta program" it implies does not exist yet. Kept rather
          -- than dropped because dropping it deletes the feature's only
          -- remaining trace; wire it or remove it deliberately.
          -- daily_scan_limit is a per-user override of the plan's daily scan
          -- allowance. Nothing writes it (the admin "set scan limit" action
          -- was removed, see app/api/v3/admin/route.ts) and nothing enforces
          -- it: lib/rate-limiting/daily-limits.ts uses the plan limit.
          beta_access BOOLEAN NOT NULL DEFAULT false,
          daily_scan_limit INTEGER DEFAULT NULL,

          -- Account status
          email_verified_at TIMESTAMP WITH TIME ZONE,
          tos_accepted_at TIMESTAMP WITH TIME ZONE,
          disabled_at TIMESTAMP WITH TIME ZONE,
          onboarding_completed BOOLEAN NOT NULL DEFAULT false,
          
          -- Two-factor authentication
          totp_secret VARCHAR(255),
          totp_enabled BOOLEAN NOT NULL DEFAULT false,
          two_factor_method VARCHAR(10),
          backup_codes TEXT,
          -- AUDIT-011#drift-17: users.email_session_revoked used to sit
          -- here. It was a legacy duplicate of the real preference, which
          -- lives on notification_preferences (see that table below): all
          -- nine live references -- the unsubscribe page, the profile
          -- notifications tab, lib/notifications/notifications.ts's
          -- session_alerts mapping, the signup and OAuth-callback INSERTs
          -- -- resolve to that column, never to this one. Nothing ever read
          -- or wrote the copy on users. The 2.0.0 -> 3.0.0 migration drops
          -- it, and that step's downgrade puts it back.

          -- Timestamps
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SESSIONS - User login sessions (1 user : many sessions)
  // ════════════════════════════════════════════════════════════════
  {
    id: "sessions",
    sql: `
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(64) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          ip_address VARCHAR(45),
          user_agent TEXT,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
        -- AUDIT-010: which staff member (if any) this session was created
        -- FOR via admin impersonation, distinct from user_id (the target
        -- being impersonated). NULL for every ordinary login session. See
        -- lib/auth/impersonation.ts.
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonated_by INTEGER REFERENCES users(id);
        -- Display-only IPv4 captured out-of-band via the IPv4-only echo
        -- endpoint (see app/api/v3/whoami-ip + auth/sessions/ipv4). NULL until
        -- a signed-in browser on a dual-stack network pings the echo host;
        -- never used for the session IP-binding check (that stays ip_address).
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ipv4_address VARCHAR(45);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // API KEYS - User API keys (1 user : many keys)
  // ════════════════════════════════════════════════════════════════
  {
    id: "api-keys",
    sql: `
        CREATE TABLE IF NOT EXISTS api_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key_hash VARCHAR(255) NOT NULL UNIQUE,
          key_locator VARCHAR(32),
          key_encrypted TEXT,
          key_prefix VARCHAR(64) NOT NULL,
          name VARCHAR(100) NOT NULL DEFAULT 'Default',
          daily_limit INTEGER NOT NULL DEFAULT 50,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_used_at TIMESTAMP WITH TIME ZONE,
          revoked_at TIMESTAMP WITH TIME ZONE
        );
        CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_locator ON api_keys(key_locator);
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_locator VARCHAR(32);
        -- ip-binding: the subnet this key was first used from, once
        -- API_KEY_IP_BINDING_ENABLED is turned on (off by default). See
        -- lib/api/api-keys.ts.
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS bound_ip VARCHAR(45);
        -- scoping: capability scopes for this key (scan:write / scan:read /
        -- scan:delete -- see lib/config/client-constants.ts's
        -- API_KEY_SCOPES). Deliberately nullable with NO default: NULL means
        -- "this row predates scoping" and is treated as full access
        -- everywhere a scope is checked (lib/api/api-key-scopes.ts's
        -- hasApiKeyScope/resolveApiKeyScopes), matching the key's current
        -- unscoped behavior exactly. A DEFAULT here would be wrong -- adding
        -- a NOT NULL column with a DEFAULT backfills every existing row with
        -- that same value, and '[]' would silently revoke every capability
        -- from every API key ever issued the moment this migration runs.
        -- Every new key gets an explicit array from generateApiKey (even one
        -- containing every scope), so NULL only ever occurs on a
        -- pre-existing row.
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes JSONB;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // API USAGE - Tracks API key usage for rate limiting
  // ════════════════════════════════════════════════════════════════
  {
    id: "api-usage",
    sql: `
        CREATE TABLE IF NOT EXISTS api_usage (
          id SERIAL PRIMARY KEY,
          api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN HISTORY - Scan results (1 user : many scans)
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-history",
    sql: `
        CREATE TABLE IF NOT EXISTS scan_history (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          summary JSONB NOT NULL DEFAULT '{}',
          findings JSONB NOT NULL DEFAULT '[]',
          findings_count INTEGER NOT NULL DEFAULT 0,
          duration INTEGER NOT NULL DEFAULT 0,
          source VARCHAR(10) NOT NULL DEFAULT 'web',
          share_token VARCHAR(64) UNIQUE,
          response_headers JSONB,
          notes TEXT,
          scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_scan_history_scanned_at ON scan_history(scanned_at);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCAN TAGS - Tags on scans (many-to-many via scan_id)
  // ════════════════════════════════════════════════════════════════
  {
    id: "scan-tags",
    sql: `
        CREATE TABLE IF NOT EXISTS scan_tags (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          tag VARCHAR(50) NOT NULL,
          UNIQUE(scan_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_scan_tags_user_id ON scan_tags(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SCHEDULED SCANS - Recurring scan jobs
  // ════════════════════════════════════════════════════════════════
  {
    id: "scheduled-scans",
    sql: `
        CREATE TABLE IF NOT EXISTS scheduled_scans (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
          active BOOLEAN NOT NULL DEFAULT true,
          last_run_at TIMESTAMP WITH TIME ZONE,
          next_run_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_user_id ON scheduled_scans(user_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_next_run ON scheduled_scans(next_run_at);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // WEBHOOKS - User webhook endpoints
  // ════════════════════════════════════════════════════════════════
  {
    id: "webhooks",
    sql: `
        CREATE TABLE IF NOT EXISTS webhooks (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          name VARCHAR(100) NOT NULL DEFAULT 'Default',
          type VARCHAR(20) NOT NULL DEFAULT 'generic',
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BADGES - Badge definitions (shared across all users)
  // ════════════════════════════════════════════════════════════════
  {
    id: "badges",
    sql: `
        CREATE TABLE IF NOT EXISTS badges (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          display_name VARCHAR(100) NOT NULL,
          description TEXT,
          icon VARCHAR(50),
          color VARCHAR(20),
          priority INTEGER NOT NULL DEFAULT 0,
          -- AUDIT-011#drift-17: half-built. Seeded true for the four
          -- one-off badges below and selected by the admin badge list, but
          -- nothing renders it and nothing gates awarding on it, so
          -- "limited edition" is a label with no behaviour behind it. The
          -- admin create-badge route hardcodes false. Kept rather than
          -- dropped: dropping it deletes the feature.
          is_limited BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // USER BADGES - Junction table (user <-> badge)
  // ════════════════════════════════════════════════════════════════
  {
    id: "user-badges",
    sql: `
        CREATE TABLE IF NOT EXISTS user_badges (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
          awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (user_id, badge_id)
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BILLING HISTORY - Payment audit trail
  // ════════════════════════════════════════════════════════════════
  {
    id: "billing-history",
    sql: `
        CREATE TABLE IF NOT EXISTS billing_history (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stripe_invoice_id VARCHAR(255) UNIQUE,
          stripe_payment_intent_id VARCHAR(255),
          amount_cents INTEGER NOT NULL,
          currency VARCHAR(10) NOT NULL DEFAULT 'usd',
          status VARCHAR(50) NOT NULL,
          description TEXT,
          invoice_pdf_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // PROCESSED STRIPE EVENTS - webhook idempotency guard
  //
  // Referenced by app/api/v3/webhooks/stripe/route.ts but never had a
  // CREATE TABLE of its own, so every deployment logged "idempotency
  // check failed (continuing)" and processed every Stripe retry/replay
  // as if it were a brand new event -- re-granting badges, re-running
  // the plan-upgrade path, etc. No user_id: this is bookkeeping about
  // Stripe's event stream, not about a specific account.
  // ════════════════════════════════════════════════════════════════
  {
    id: "processed-stripe-events",
    onError: "warn",
    warning: "Failed to create/verify processed_stripe_events",
    sql: `
        CREATE TABLE IF NOT EXISTS processed_stripe_events (
          event_id VARCHAR(255) PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
          ON processed_stripe_events(processed_at);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ADMIN AUDIT LOG - Admin action audit trail
  // ════════════════════════════════════════════════════════════════
  {
    id: "admin-audit-log",
    sql: `
        CREATE TABLE IF NOT EXISTS admin_audit_log (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER,
          action VARCHAR(100) NOT NULL,
          details TEXT,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at);
    `,
  },

  // Self-healing FK on admin_audit_log.target_user_id. The CREATE TABLE above
  // declares the column as INTEGER (no FK) so legacy databases can be migrated
  // without an explicit migration. The FK is then added with ON DELETE SET
  // NULL so a user self-delete (/api/v3/account/delete) doesn't fail with a
  // 500 due to orphan audit rows pointing at a non-existent user.
  //
  // The guard makes this idempotent: if the constraint already exists on the
  // live DB, both statements are skipped.
  {
    id: "fk-admin-audit-target-user",
    onError: "warn",
    warning: "Failed to add fk_admin_audit_target_user",
    guard: {
      sql: `SELECT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE table_name = 'admin_audit_log'
               AND constraint_name = 'fk_admin_audit_target_user'
           ) AS exists`,
    },
    notice:
      "[security-migration] Added FK fk_admin_audit_target_user -> users(id) ON DELETE SET NULL",
    sql: [
      // Delete any orphan rows first (should be none, but be safe).
      `DELETE FROM admin_audit_log
             WHERE target_user_id IS NOT NULL
               AND target_user_id NOT IN (SELECT id FROM users)`,
      `ALTER TABLE admin_audit_log
               ADD CONSTRAINT fk_admin_audit_target_user
               FOREIGN KEY (target_user_id)
               REFERENCES users(id) ON DELETE SET NULL`,
    ],
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM ERROR LOGS - admin-visible capture of console.error calls
  // (Admin > System > Error Logs). Same append-only, id +
  // created_at-indexed shape as admin_audit_log just above; see
  // lib/database/error-log-capture.ts for the console.error
  // interception that writes rows here, and
  // app/api/v3/admin/error-logs/route.ts for the read/clear API.
  // Pruned by lib/database/cleanup.ts like every other log table.
  // ════════════════════════════════════════════════════════════════
  {
    id: "system-error-logs",
    onError: "warn",
    warning: "Failed to create/verify system_error_logs",
    sql: `
        CREATE TABLE IF NOT EXISTS system_error_logs (
          id SERIAL PRIMARY KEY,
          message TEXT NOT NULL,
          detail TEXT,
          request_id VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        -- AUDIT-012#obs-07: the correlation id middleware.ts mints per
        -- request, re-entered into Node-side context by withErrorHandling
        -- and read back by lib/database/request-context.ts's
        -- currentRequestId(). Every row one failing request produces
        -- (route -> executeScan -> a check -> safeFetch) now shares one
        -- value instead of being several unrelated lines of English.
        -- The ALTER is what gives it to the databases that already have
        -- this table: CREATE TABLE IF NOT EXISTS above no-ops for them,
        -- and the INSERT names the column unconditionally.
        ALTER TABLE system_error_logs
          ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);
        CREATE INDEX IF NOT EXISTS idx_system_error_logs_created_at
          ON system_error_logs(created_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // EMAIL LOGS - admin-visible record of every outbound email attempt
  // (Admin > System > Email Logs, AUDIT-010). Written by
  // lib/email/email.ts's sendEmail() itself -- the single choke point
  // every email path (notifications, password reset, staff invites,
  // 2FA codes, ...) already funnels through -- so this covers every
  // send without each caller remembering to log it. `redacted_preview`
  // never carries the raw subject/body: any link, numeric code, or
  // long token is replaced with a [REDACTED ...] marker before storage
  // (see redactEmailPreview in that file), so staff can see an email
  // was sent and roughly what kind, never a working reset link or 2FA
  // code. `status` reflects only "the SMTP server accepted it for
  // delivery" (or didn't) -- plain SMTP has no true read-receipt or
  // inbox-delivery signal. Pruned by lib/database/cleanup.ts.
  // ════════════════════════════════════════════════════════════════
  {
    id: "email-logs",
    onError: "warn",
    warning: "Failed to create/verify email_logs",
    sql: `
        CREATE TABLE IF NOT EXISTS email_logs (
          id SERIAL PRIMARY KEY,
          recipient VARCHAR(255) NOT NULL,
          subject TEXT NOT NULL,
          status VARCHAR(30) NOT NULL,
          error_message TEXT,
          redacted_preview TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_email_logs_created_at
          ON email_logs(created_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ADMIN USER NOTES - Admin notes on users
  // ════════════════════════════════════════════════════════════════
  {
    id: "admin-user-notes",
    sql: `
        CREATE TABLE IF NOT EXISTS admin_user_notes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user ON admin_user_notes(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DISCORD CONNECTIONS - OAuth integration with Discord
  // ════════════════════════════════════════════════════════════════
  {
    id: "discord-connections",
    sql: `
        CREATE TABLE IF NOT EXISTS discord_connections (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          discord_id VARCHAR(64) NOT NULL UNIQUE,
          discord_username VARCHAR(100) NOT NULL,
          discord_discriminator VARCHAR(10),
          discord_avatar VARCHAR(255),
          discord_email VARCHAR(255),
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          token_expires_at TIMESTAMP WITH TIME ZONE,
          guild_joined BOOLEAN NOT NULL DEFAULT false,
          connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // STAFF ACTIVITY - Real-time admin dashboard activity tracking
  // ════════════════════════════════════════════════════════════════
  {
    id: "staff-activity",
    sql: `
        CREATE TABLE IF NOT EXISTS staff_activity (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          current_section VARCHAR(50),
          ip_address TEXT,
          user_agent TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_staff_activity_heartbeat ON staff_activity(last_heartbeat DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // AUTH TOKENS - Password reset & email verification
  // ════════════════════════════════════════════════════════════════
  {
    id: "auth-tokens",
    sql: `
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_evt_token_hash ON email_verification_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS email_2fa_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash VARCHAR(255) NOT NULL,
          -- L-2: per-row salt. The 6-digit code space (10^6) is
          -- small enough that unsalted SHA-256 is rainbow-tableable
          -- if the DB leaks. With a per-row 32-byte salt, an attacker
          -- must run a full pre-image search for each leak row.
          code_salt VARCHAR(64) NOT NULL DEFAULT '0',
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_email_2fa_user ON email_2fa_codes(user_id);
        -- The CREATE TABLE above only supplies code_salt on a database that
        -- does not have email_2fa_codes yet. IF NOT EXISTS no-ops against a
        -- table created before the salt column existed, so an upgraded
        -- install was left without it while every insert path writes it
        -- (app/api/v3/auth/login, 2fa/email-send, oauth callback,
        -- lib/discord/discord-utils) -- email 2FA was simply broken there.
        -- The DEFAULT keeps this safe on a populated table; the sentinel '0'
        -- rows it produces are deleted by the self-heal further down.
        ALTER TABLE email_2fa_codes ADD COLUMN IF NOT EXISTS code_salt VARCHAR(64) NOT NULL DEFAULT '0';

        CREATE TABLE IF NOT EXISTS billing_verification_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_billing_verify_user ON billing_verification_codes(user_id);
        CREATE INDEX IF NOT EXISTS idx_billing_verify_expires ON billing_verification_codes(expires_at);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // NOTIFICATION PREFERENCES
  // ════════════════════════════════════════════════════════════════
  {
    id: "notification-preferences",
    sql: `
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          -- Security notifications
          email_security BOOLEAN NOT NULL DEFAULT true,
          email_new_login BOOLEAN NOT NULL DEFAULT true,
          email_password_change BOOLEAN NOT NULL DEFAULT true,
          email_2fa_change BOOLEAN NOT NULL DEFAULT true,
          email_session_revoked BOOLEAN NOT NULL DEFAULT true,
          -- Scanning notifications
          email_scan_complete BOOLEAN NOT NULL DEFAULT true,
          email_critical_findings BOOLEAN NOT NULL DEFAULT true,
          email_regression_alert BOOLEAN NOT NULL DEFAULT true,
          email_schedules BOOLEAN NOT NULL DEFAULT true,
          -- API & Integrations
          email_api_keys BOOLEAN NOT NULL DEFAULT true,
          email_api_limit_warning BOOLEAN NOT NULL DEFAULT true,
          email_webhooks BOOLEAN NOT NULL DEFAULT true,
          email_webhook_failure BOOLEAN NOT NULL DEFAULT true,
          -- Account notifications
          email_data_requests BOOLEAN NOT NULL DEFAULT true,
          email_account_deletion BOOLEAN NOT NULL DEFAULT true,
          email_team_invite BOOLEAN NOT NULL DEFAULT true,
          email_team_changes BOOLEAN NOT NULL DEFAULT true,
          -- Product notifications
          email_product_updates BOOLEAN NOT NULL DEFAULT true,
          email_tips_guides BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // RATE LIMITING
  // ════════════════════════════════════════════════════════════════
  {
    id: "rate-limits",
    sql: `
        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) NOT NULL,
          "count" INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(key, window_start)
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DEVICE TRUST - Trusted devices for 2FA
  // ════════════════════════════════════════════════════════════════
  {
    id: "device-trust",
    sql: `
        CREATE TABLE IF NOT EXISTS device_trust (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_fingerprint VARCHAR(255) NOT NULL,
          device_name VARCHAR(255),
          ip_address VARCHAR(45),
          user_agent TEXT,
          last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          UNIQUE(user_id, device_fingerprint)
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // DATA REQUESTS - GDPR data export
  // ════════════════════════════════════════════════════════════════
  {
    id: "data-requests",
    sql: `
        CREATE TABLE IF NOT EXISTS data_requests (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          data TEXT,
          requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          -- AUDIT-011#drift-17: completed_at used to sit here and was never
          -- written or read by anything; the export route stamps
          -- downloaded_at and nothing else. Dropped by the 2.0.0 -> 3.0.0
          -- migration, restored by its downgrade.
          downloaded_at TIMESTAMP WITH TIME ZONE
        );
        CREATE INDEX IF NOT EXISTS idx_data_requests_user_id ON data_requests(user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // TEAMS
  // ════════════════════════════════════════════════════════════════
  {
    id: "teams",
    sql: `
        CREATE TABLE IF NOT EXISTS teams (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          slug VARCHAR(100) UNIQUE NOT NULL,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS team_members (
          id SERIAL PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(20) NOT NULL DEFAULT 'viewer',
          joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(team_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

        CREATE TABLE IF NOT EXISTS team_invites (
          id SERIAL PRIMARY KEY,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL DEFAULT 'viewer',
          token VARCHAR(64) NOT NULL UNIQUE,
          invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          accepted_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ORG-LEVEL RESOURCE SCOPING (AUDIT-010 #273) -- a scan/API key/
  // webhook/schedule can optionally belong to a team instead of only
  // its creating user. Nullable: existing rows and personal (non-team)
  // resources are unaffected. ON DELETE SET NULL, not CASCADE -- a
  // team owner deleting the team must not silently destroy every
  // member's scan history; the resource just reverts to personal.
  // ════════════════════════════════════════════════════════════════
  {
    id: "team-resource-scoping",
    sql: `
        ALTER TABLE scan_history ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_scan_history_team_id ON scan_history(team_id) WHERE team_id IS NOT NULL;

        -- AUDIT-011#drift-17: api_keys.team_id and its partial index used to
        -- be here. Unlike the other three, nothing ever referenced it:
        -- lib/api/api-keys.ts and app/api/v3/keys create, list, scope and
        -- revoke keys entirely per-user, so a team-owned API key was a
        -- column and an index maintained on every key write for no read.
        -- The other three below are live. Dropped by the 2.0.0 -> 3.0.0
        -- migration, restored by its downgrade.

        ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_webhooks_team_id ON webhooks(team_id) WHERE team_id IS NOT NULL;

        ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_team_id ON scheduled_scans(team_id) WHERE team_id IS NOT NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // MULTI-TEAM SCAN SHARING - scan_history_teams
  //
  // scan_history.team_id above holds ONE team, which is all a scan could ever
  // be shared with. This join table is the many side; the column stays and
  // stays in sync as the PRIMARY team, because dropping a column in the same
  // change that introduces its replacement makes a rollback lossy.
  //
  // ON DELETE CASCADE on both sides, deliberately unlike the column's SET
  // NULL: a row here is only a membership fact, so deleting the team removes
  // the membership, while the scan itself survives via the column's own SET
  // NULL.
  //
  // The backfill is unconditional and idempotent on purpose. It is not a
  // one-time history migration: three write paths in lib/scanner/ still write
  // only the column, so running it on every boot is what converges the two
  // representations until they don't.
  //
  // PRIMARY KEY (scan_id, team_id) has to stay a TABLE-LEVEL constraint line.
  // parseUniqueTargets in scripts/_lib/_lib.schema-parity.mjs only recognises
  // that form, and lib/teams' `ON CONFLICT (scan_id, team_id)` is validated
  // against what it finds (tests/lib/database/on-conflict-parity.test.ts).
  {
    id: "scan-history-teams",
    sql: `
        CREATE TABLE IF NOT EXISTS scan_history_teams (
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          PRIMARY KEY (scan_id, team_id)
        );

        CREATE INDEX IF NOT EXISTS idx_scan_history_teams_team
          ON scan_history_teams(team_id);

        INSERT INTO scan_history_teams (scan_id, team_id)
        SELECT id, team_id FROM scan_history WHERE team_id IS NOT NULL
        ON CONFLICT (scan_id, team_id) DO NOTHING;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // GIFTED SUBSCRIPTIONS - Manual plan gifts
  // ════════════════════════════════════════════════════════════════
  {
    id: "gifted-subscriptions",
    sql: `
        CREATE TABLE IF NOT EXISTS gifted_subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          gifted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan VARCHAR(50) NOT NULL,
          -- AUDIT-011#drift-17: half-built. The GDPR export selects it
          -- (app/api/v3/data-request/route.ts), but the only INSERT
          -- (app/api/v3/admin/route.ts's gift action) omits it and the gift
          -- dialog has no field for it, so it is NULL on every row that
          -- exists. Kept rather than dropped: the export already promises
          -- the user a reason, so the fix is to collect one.
          reason TEXT,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          revoked_at TIMESTAMP WITH TIME ZONE,
          revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_user ON gifted_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_expires ON gifted_subscriptions(expires_at) WHERE revoked_at IS NULL;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ADMIN NOTIFICATIONS - Site-wide notifications
  // ════════════════════════════════════════════════════════════════
  {
    id: "admin-notifications",
    sql: `
        CREATE TABLE IF NOT EXISTS admin_notifications (
          id SERIAL PRIMARY KEY,
          cookie_id VARCHAR(32) NOT NULL UNIQUE,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(20) NOT NULL DEFAULT 'bell' CHECK (type IN ('banner', 'modal', 'toast', 'bell')),
          variant VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (variant IN ('info', 'success', 'warning', 'error')),
          audience VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'authenticated', 'unauthenticated', 'admin', 'staff')),
          path_pattern VARCHAR(255) DEFAULT NULL,
          starts_at TIMESTAMPTZ DEFAULT NOW(),
          ends_at TIMESTAMPTZ DEFAULT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          is_dismissible BOOLEAN NOT NULL DEFAULT true,
          dismiss_duration_hours INTEGER DEFAULT NULL,
          action_label VARCHAR(100) DEFAULT NULL,
          action_url VARCHAR(500) DEFAULT NULL,
          action_external BOOLEAN DEFAULT false,
          action_label_2 VARCHAR(100) DEFAULT NULL,
          action_url_2 VARCHAR(500) DEFAULT NULL,
          action_external_2 BOOLEAN DEFAULT false,
          priority INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_active ON admin_notifications (is_active, starts_at, ends_at) WHERE is_active = true;
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications (type);

        -- Second, optional action button (e.g. "Add to Chrome" + "Add to Firefox"
        -- on the same notification). Idempotent for databases created before
        -- this pair existed.
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_label_2 VARCHAR(100) DEFAULT NULL;
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_url_2 VARCHAR(500) DEFAULT NULL;
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_external_2 BOOLEAN DEFAULT false;
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // ACCESS RULES - IP and URL Whitelisting/Blacklisting
  // ════════════════════════════════════════════════════════════════
  {
    id: "access-rules",
    sql: `
        CREATE TABLE IF NOT EXISTS access_rules (
          id SERIAL PRIMARY KEY,
          rule_type VARCHAR(10) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
          value_type VARCHAR(10) NOT NULL DEFAULT 'ip' CHECK (value_type IN ('ip', 'url')),
          value TEXT NOT NULL,
          description TEXT,
          reason VARCHAR(255),
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_hit_at TIMESTAMP WITH TIME ZONE,
          -- Plain INTEGER, no inline REFERENCES (AUDIT-013 schema-01). An
          -- inline REFERENCES with no ON DELETE clause creates a real
          -- constraint, access_rules_created_by_fkey, with ON DELETE NO
          -- ACTION. The self-heal below then added a SECOND constraint
          -- with ON DELETE SET NULL and never dropped the first, so the
          -- column carried two foreign keys that disagreed about what a
          -- user deletion means, and the older NO ACTION check fired
          -- first: deleting any staff account that had ever created an
          -- access rule failed the whole GDPR erasure transaction. The FK
          -- is added by that self-heal instead, exactly once. Same shape
          -- as admin_audit_log.target_user_id above.
          created_by INTEGER,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP WITH TIME ZONE,
          is_active BOOLEAN NOT NULL DEFAULT true,
          UNIQUE(rule_type, value_type, value)
        );
CREATE INDEX IF NOT EXISTS idx_access_rules_active ON access_rules(is_active,
          rule_type);
        CREATE INDEX IF NOT EXISTS idx_access_rules_value ON access_rules(value);
        CREATE INDEX IF NOT EXISTS idx_access_rules_type ON access_rules(value_type);
    `,
  },

  // AUDIT-013 schema-01: drop the inline constraint the old CREATE TABLE
  // produced, so access_rules.created_by ends up with exactly one foreign key.
  // Unguarded, unlike the step below it: on a database where
  // fk_access_rules_created_by was already added by an earlier boot, the
  // duplicate NO ACTION constraint is still sitting there and a guarded
  // version would never reach it. Same order as the
  // broadcast_messages.created_by fix further down.
  {
    id: "access-rules-drop-inline-fk",
    onError: "warn",
    warning: "Failed to drop the inline access_rules.created_by foreign key",
    sql: `ALTER TABLE access_rules
             DROP CONSTRAINT IF EXISTS access_rules_created_by_fkey`,
  },

  // Self-healing FK on access_rules.created_by. The CREATE TABLE above
  // declares it as a plain INTEGER; this makes it nullable and adds the one
  // real constraint, ON DELETE SET NULL, so a user self-delete
  // (/api/v3/account/delete) cannot fail on a rule they once created.
  {
    id: "fk-access-rules-created-by",
    onError: "warn",
    warning: "Failed to add fk_access_rules_created_by",
    guard: {
      sql: `SELECT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE table_name = 'access_rules'
               AND constraint_name = 'fk_access_rules_created_by'
           ) AS exists`,
    },
    notice:
      "[security-migration] Added FK fk_access_rules_created_by -> users(id) ON DELETE SET NULL",
    sql: [
      // First make the column nullable so ON DELETE SET NULL is legal.
      `ALTER TABLE access_rules
               ALTER COLUMN created_by DROP NOT NULL`,
      `ALTER TABLE access_rules
               ADD CONSTRAINT fk_access_rules_created_by
               FOREIGN KEY (created_by)
               REFERENCES users(id) ON DELETE SET NULL`,
    ],
  },

  // L-2: self-healing migration for the email_2fa_codes salt column. The
  // original schema was unsalted; code_salt was added as NOT NULL DEFAULT '0'
  // so the CREATE TABLE succeeds against a legacy DB, but the existing rows
  // are still un-salted. They carry the sentinel salt, and they are 10-min-TTL
  // rows, so deleting them on every boot is safe. New rows get a fresh 32-byte
  // salt per issue.
  {
    id: "email-2fa-codes-unsalted-cleanup",
    onError: "warn",
    warning: "Failed to clean up unsalted email_2fa_codes",
    guard: {
      sql: `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'email_2fa_codes' AND column_name = 'code_salt'
           ) AS exists`,
      runWhen: true,
    },
    sql: `DELETE FROM email_2fa_codes WHERE code_salt = '0'`,
  },

  // Drop any leftover unsalted rows. They're 10-min-TTL so
  // this is safe to do on every boot.
  {
    id: "security-alerts",
    sql: `
        CREATE TABLE IF NOT EXISTS security_alerts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          alert_type VARCHAR(50) NOT NULL,
          severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
          description TEXT NOT NULL,
          details JSONB,
          ip_address INET,
          user_agent TEXT,
          resolved_at TIMESTAMP WITH TIME ZONE,
          resolved_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          action_taken VARCHAR(100)
        );
        CREATE INDEX IF NOT EXISTS idx_security_alerts_user ON security_alerts(user_id);
        CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
        CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON security_alerts(created_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SYSTEM SETTINGS - Global configuration
  // ════════════════════════════════════════════════════════════════
  {
    id: "system-settings",
    sql: `
        CREATE TABLE IF NOT EXISTS system_settings (
          id SERIAL PRIMARY KEY,
          key VARCHAR(100) NOT NULL UNIQUE,
          value TEXT NOT NULL,
          description TEXT,
          -- AUDIT-011#drift-17: setting_type used to sit here. Nothing ever
          -- wrote or read it: every setting is stored and parsed as text by
          -- its own caller. Dropped by the 2.0.0 -> 3.0.0 migration,
          -- restored by its downgrade.
          updated_by INTEGER REFERENCES users(id),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BROADCAST MESSAGES - Mass communication
  // ════════════════════════════════════════════════════════════════
  {
    id: "broadcast-messages",
    sql: `
        CREATE TABLE IF NOT EXISTS broadcast_messages (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          -- AUDIT-011#drift-17: message_type and scheduled_at are both
          -- half-built, kept rather than dropped because dropping them
          -- deletes the feature they belong to. The admin mass-email UI
          -- hardcodes message_type 'email' and the send path never reads
          -- it, so 'in_app' and 'announcement' are unreachable. scheduled_at
          -- is written by nothing and consumed by no worker, which is also
          -- why the status CHECK's 'scheduled' and 'cancelled' values below
          -- can never be written: the send path goes 'draft' -> 'sent'.
          message_type VARCHAR(50) NOT NULL CHECK (message_type IN ('email', 'in_app', 'announcement')),
          segment_filter JSONB,
          scheduled_at TIMESTAMP WITH TIME ZONE,
          sent_at TIMESTAMP WITH TIME ZONE,
          created_by INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled'))
        );
        CREATE INDEX IF NOT EXISTS idx_broadcast_messages_status ON broadcast_messages(status);
        CREATE INDEX IF NOT EXISTS idx_broadcast_messages_created ON broadcast_messages(created_at DESC);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // BROADCAST RECIPIENTS - Tracking message delivery
  // ════════════════════════════════════════════════════════════════
  {
    id: "broadcast-recipients",
    sql: `
        CREATE TABLE IF NOT EXISTS broadcast_recipients (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          -- AUDIT-011#drift-17: opened_at and clicked_at used to sit here.
          -- Neither was ever written or read: there is no tracking pixel and
          -- no link-wrapping redirect, so open/click data never existed. The
          -- status CHECK below keeps its 'opened'/'clicked' values for the
          -- same reason it always had them, which is that nothing writes
          -- those either. Dropped by the 2.0.0 -> 3.0.0 migration, restored
          -- by its downgrade.
          status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'opened', 'clicked')),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_user ON broadcast_recipients(user_id);
    `,
  },

  // AUDIT-013 schema-08 / AUDIT-012 perf-15(8): broadcast_recipients had
  // a surrogate id and no uniqueness on (message_id, user_id), so the
  // send loop's "have we already delivered to this person" guard was a
  // SELECT followed by an INSERT with the whole SMTP round trip in
  // between. Two concurrent sends both pass the SELECT and the entire
  // verified user base can receive the same broadcast twice. The unique
  // index is what makes an insert-first `ON CONFLICT (message_id,
  // user_id) DO NOTHING RETURNING id` claim possible, and it doubles as
  // the composite read index that guard wanted. Duplicates that already
  // exist are collapsed to the earliest row first, otherwise the index
  // cannot be built; the discarded rows are redundant copies of the same
  // delivery record.
  {
    id: "broadcast-recipients-message-user-index",
    onError: "warn",
    warning: "Failed to add broadcast_recipients uniqueness",
    sql: `
        DELETE FROM broadcast_recipients a
          USING broadcast_recipients b
         WHERE a.message_id = b.message_id
           AND a.user_id = b.user_id
           AND a.id > b.id;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_message_user
          ON broadcast_recipients(message_id, user_id);
    `,
  },

  // ════════════════════════════════════════════════════════════════
  // SUBDOMAIN CACHE - Caches subdomain discovery results (4 hour TTL)
  // ════════════════════════════════════════════════════════════════
  {
    id: "subdomain-cache",
    sql: `
        CREATE TABLE IF NOT EXISTS subdomain_cache (
          domain VARCHAR(255) PRIMARY KEY,
          subdomains JSONB NOT NULL,
          cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_subdomain_cache_cached_at ON subdomain_cache(cached_at);
    `,
  },
];
