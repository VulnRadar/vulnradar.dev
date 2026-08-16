/**
 * Database initialization and schema management
 * Runs on server startup to ensure all required tables exist
 *
 * SCHEMA PHILOSOPHY:
 * - Users table contains ALL user-specific data (role, plan, billing, settings)
 * - Separate tables only for: 1-to-many relationships, audit trails, shared definitions
 * - No unnecessary junction tables - use simple foreign keys where possible
 */

/**
 * Compare two "X.Y.Z" semver-style strings. Returns -1 if a < b, 0 if
 * a == b, 1 if a > b. Missing segments default to 0. Used to compare
 * schema versions stored in vulnradar_schema_meta.
 */
function compareVersions(a: string, b: string): number {
  const av = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const bv = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // fail-fast on missing required env vars. Previously the
    // process would start with no schema, then 500 on every request. Now
    // startup aborts with a clear error message pointing at the missing var.
    const { validateEnv } = await import("./lib/config/env");
    const env = validateEnv();
    void env; // referenced for side-effect (throws on invalid env)

    const { default: pool } = await import("./lib/database/db");
    const {
      APP_NAME,
      APP_VERSION,
      MIN_SCHEMA_VERSION,
      ENGINE_VERSION,
      VERSION_CHECK_URL,
      RELEASES_URL,
    } = await import("./lib/config/constants");

    // ── System error log capture (Admin > System > Error Logs) ─────────
    // Wraps console.error exactly once per process so every genuine error
    // logged anywhere in the app (see CLAUDE.md's console.error/console.log
    // convention) also lands in system_error_logs, viewable from the admin
    // panel without shell/SSH access. installErrorLogCapture() is itself
    // idempotent (guards on a module-level flag), so this is also safe on
    // dev hot-reload re-execution of this function. Installed this early
    // so it captures errors later in this same register() call too --
    // inserts attempted before the system_error_logs table exists below
    // simply fail closed (best-effort only, see lib/database/error-log-capture.ts).
    try {
      const { installErrorLogCapture } =
        await import("./lib/database/error-log-capture");
      installErrorLogCapture();
    } catch (captureErr) {
      console.error(
        `[${APP_NAME}] Failed to install error log capture (non-fatal):`,
        captureErr,
      );
    }

    // crypto: backfill any plaintext TOTP / Discord tokens that were
    // stored before encryption was added. Idempotent — rows already
    // in ciphertext form are skipped.
    try {
      const { migratePlaintextSecretsToEncrypted } =
        await import("./lib/auth/security-migration");
      await migratePlaintextSecretsToEncrypted();
    } catch (err) {
      console.error(
        "[security-migration] Failed to backfill plaintext secrets:",
        err,
      );
    }

    // ── Schema version check (BEFORE any table creation) ───────────────
    // The app requires MIN_SCHEMA_VERSION. If the connected database is
    // older (or has no meta row at all), block startup so the app
    // doesn't crash trying to create indexes on columns that don't
    // exist (e.g. CREATE INDEX idx_users_plan on a v1 DB where
    // users.plan doesn't exist). The friendly error tells the user
    // exactly which command to run to fix it.
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vulnradar_schema_meta (
          id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          schema_version VARCHAR(20) NOT NULL,
          app_version     VARCHAR(20) NOT NULL,
          applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const metaRes = await pool.query(`
        SELECT schema_version, app_version, applied_at
        FROM vulnradar_schema_meta
        WHERE id = 1
      `);

      if (metaRes.rows.length === 0) {
        const BOX_INNER = 72;
        const pad = (text: string) => {
          const visible = text.length;
          const right = BOX_INNER - 2 - visible;
          return "║  " + text + " ".repeat(Math.max(0, right)) + "║";
        };
        const top = "╔" + "═".repeat(BOX_INNER) + "╗";
        const bot = "╚" + "═".repeat(BOX_INNER) + "╝";
        const blank = "║" + " ".repeat(BOX_INNER) + "║";
        const lines = [
          top,
          pad("SCHEMA VERSION NOT SET"),
          blank,
          pad("This database has no schema version recorded."),
          blank,
          pad("The database was probably created without going"),
          pad("through the migration tool. To start the app, do one of:"),
          blank,
          pad("  1. Run the migration to detect and set the version:"),
          pad("       npm run db:migrate"),
          blank,
          pad("  2. Or create a fresh database:"),
          pad("       npm run db:create"),
          blank,
          pad("If you want to use a different database, update your"),
          pad("DATABASE_URL in .env.local."),
          bot,
        ];
        console.error("");
        console.error("\x1b[31m\x1b[1m");
        for (const ln of lines) console.error(ln);
        console.error("\x1b[0m");
        const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
        await sendAdminAlert({
          event: "boot_schema_version_unset",
          severity: "critical",
          message: `${APP_NAME} failed to start: database has no schema version recorded.`,
        });
        process.exit(1);
      }

      const dbSchema = metaRes.rows[0].schema_version as string;
      const cmp = compareVersions(dbSchema, MIN_SCHEMA_VERSION);
      if (cmp < 0) {
        const BOX_INNER = 72;
        const pad = (text: string) => {
          const visible = text.length;
          const right = BOX_INNER - 2 - visible;
          return "║  " + text + " ".repeat(Math.max(0, right)) + "║";
        };
        const top = "╔" + "═".repeat(BOX_INNER) + "╗";
        const bot = "╚" + "═".repeat(BOX_INNER) + "╝";
        const blank = "║" + " ".repeat(BOX_INNER) + "║";
        const lines = [
          top,
          pad("SCHEMA VERSION MISMATCH"),
          blank,
          pad("Database schema:    v" + dbSchema),
          pad("App requires:        v" + MIN_SCHEMA_VERSION),
          blank,
          pad("This app cannot start on this database."),
          pad("It expects columns and tables that don't exist yet."),
          blank,
          pad("To fix:"),
          pad("  1. Run the migration to upgrade the database:"),
          pad("       npm run db:migrate"),
          blank,
          pad("  2. Or, if you want to use a different (newer) database,"),
          pad("     update DATABASE_URL in .env.local."),
          blank,
          pad("The app will not start until the database is upgraded."),
          bot,
        ];
        console.error("");
        console.error("\x1b[31m\x1b[1m");
        for (const ln of lines) console.error(ln);
        console.error("\x1b[0m");
        const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
        await sendAdminAlert({
          event: "boot_schema_version_mismatch",
          severity: "critical",
          message: `${APP_NAME} failed to start: database schema v${dbSchema} is older than the required v${MIN_SCHEMA_VERSION}. Run npm run db:migrate.`,
        });
        process.exit(1);
      }

      console.log(
        `[${APP_NAME}] Schema version: v${dbSchema} (required: v${MIN_SCHEMA_VERSION}) ✓`,
      );
    } catch (schemaError) {
      console.error(`[${APP_NAME}] Schema version check failed:`, schemaError);
      const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
      await sendAdminAlert({
        event: "boot_schema_check_failed",
        severity: "critical",
        message: `${APP_NAME} failed to start: the schema version check itself errored.`,
      });
      process.exit(1);
    }

    // ── Startup version check ───────────────────────────────────────
    console.log(
      `\x1b[36m[${APP_NAME}]\x1b[0m Starting ${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`,
    );
    try {
      const vRes = await fetch(VERSION_CHECK_URL, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/vnd.github+json" },
      });
      if (vRes.ok) {
        const release = await vRes.json();
        const tagName = (release.tag_name as string) || "";
        const latest = tagName.replace(/^v/, "");
        const releaseUrl =
          (release.html_url as string) || `${RELEASES_URL}/tag/${tagName}`;
        const cur = APP_VERSION.split(".").map(Number);
        const lat = latest.split(".").map(Number);

        let status: "current" | "behind" | "ahead" = "current";
        for (let i = 0; i < 3; i++) {
          if ((cur[i] || 0) > (lat[i] || 0)) {
            status = "ahead";
            break;
          }
          if ((cur[i] || 0) < (lat[i] || 0)) {
            status = "behind";
            break;
          }
        }

        if (status === "current") {
          console.log(
            `\x1b[32m[${APP_NAME}]\x1b[0m You're running the latest version (v${APP_VERSION}).`,
          );
        } else if (status === "behind") {
          console.log(
            `\x1b[33m[${APP_NAME}]\x1b[0m Update available! You're on v${APP_VERSION}, latest is v${latest}.`,
          );
          console.log(`\x1b[33m[${APP_NAME}]\x1b[0m ${releaseUrl}`);
        } else {
          const msgs = [
            "Whoa, you're running a version from the future!",
            "Nice try, time traveler.",
            "You're ahead of us... literally.",
            "Running unreleased code? You absolute legend.",
          ];
          console.log(
            `\x1b[35m[${APP_NAME}]\x1b[0m Running v${APP_VERSION}, but latest release is v${latest}.`,
          );
          console.log(
            `\x1b[35m[${APP_NAME}]\x1b[0m ${msgs[Math.floor(Math.random() * msgs.length)]}`,
          );
        }
      }
    } catch {
      console.log(
        `\x1b[90m[${APP_NAME}]\x1b[0m Could not check for updates. Running v${APP_VERSION}.`,
      );
    }

    if (!process.env.DATABASE_URL) {
      // throw instead of silently returning. validateEnv()
      // already catches this, but keep a defensive check in case the schema
      // is bypassed in test contexts.
      throw new Error(
        `[${APP_NAME}] DATABASE_URL is not configured. Set it in .env or your deployment environment.`,
      );
    }

    try {
      // ════════════════════════════════════════════════════════════════
      // USERS - The central table. Contains ALL user data.
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
          email_session_revoked BOOLEAN NOT NULL DEFAULT false,
          
          -- Timestamps
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
        CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
        CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // SESSIONS - User login sessions (1 user : many sessions)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
      `);

      // ════════════════════════════════════════════════════════════════
      // API KEYS - User API keys (1 user : many keys)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_locator ON api_keys(key_locator);
        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_locator VARCHAR(32);
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_locator_backfill
          ON api_keys(key_locator)
          WHERE key_locator IS NULL;
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
      `);

      // ════════════════════════════════════════════════════════════════
      // API USAGE - Tracks API key usage for rate limiting
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_usage (
          id SERIAL PRIMARY KEY,
          api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at);
      `);

      // ════════════════════════════════════════════════════════════════
      // SCAN HISTORY - Scan results (1 user : many scans)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_scan_history_user_id ON scan_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_scan_history_scanned_at ON scan_history(scanned_at);
        CREATE INDEX IF NOT EXISTS idx_scan_history_share_token ON scan_history(share_token);
      `);

      // ════════════════════════════════════════════════════════════════
      // SCAN TAGS - Tags on scans (many-to-many via scan_id)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scan_tags (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
          tag VARCHAR(50) NOT NULL,
          UNIQUE(scan_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_scan_tags_scan_id ON scan_tags(scan_id);
        CREATE INDEX IF NOT EXISTS idx_scan_tags_user_id ON scan_tags(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // SCHEDULED SCANS - Recurring scan jobs
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
      `);

      // ════════════════════════════════════════════════════════════════
      // WEBHOOKS - User webhook endpoints
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
      `);

      // ════════════════════════════════════════════════════════════════
      // BADGES - Badge definitions (shared across all users)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS badges (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          display_name VARCHAR(100) NOT NULL,
          description TEXT,
          icon VARCHAR(50),
          color VARCHAR(20),
          priority INTEGER NOT NULL DEFAULT 0,
          is_limited BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_badges_name ON badges(name);
      `);

      // ════════════════════════════════════════════════════════════════
      // USER BADGES - Junction table (user <-> badge)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_badges (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
          awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (user_id, badge_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // BILLING HISTORY - Payment audit trail
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
      `);

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS processed_stripe_events (
          event_id VARCHAR(255) PRIMARY KEY,
          event_type VARCHAR(100) NOT NULL,
          processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
          ON processed_stripe_events(processed_at);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify processed_stripe_events (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // ADMIN AUDIT LOG - Admin action audit trail
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
          id SERIAL PRIMARY KEY,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          target_user_id INTEGER,
          action VARCHAR(100) NOT NULL,
          details TEXT,
          ip_address VARCHAR(45),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_log(admin_id);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at);
      `);

      // db: self-healing FK on admin_audit_log.target_user_id. The
      // CREATE TABLE above declares the column as INTEGER (no FK)
      // so legacy databases can be migrated without an explicit
      // migration. We then add the FK with ON DELETE SET NULL so a
      // user self-delete (`/api/v3/account/delete`) doesn't fail
      // with a 500 due to orphan audit rows pointing at a
      // non-existent user.
      //
      // The check_information_schema query makes this idempotent: if
      // the constraint already exists on the live DB, the ALTER is
      // skipped.
      try {
        const fkCheck = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE table_name = 'admin_audit_log'
               AND constraint_name = 'fk_admin_audit_target_user'
           ) AS exists`,
        );
        if (!fkCheck.rows[0]?.exists) {
          // Delete any orphan rows first (should be none, but be safe).
          await pool.query(
            `DELETE FROM admin_audit_log
             WHERE target_user_id IS NOT NULL
               AND target_user_id NOT IN (SELECT id FROM users)`,
          );
          await pool.query(
            `ALTER TABLE admin_audit_log
               ADD CONSTRAINT fk_admin_audit_target_user
               FOREIGN KEY (target_user_id)
               REFERENCES users(id) ON DELETE SET NULL`,
          );
          console.log(
            "[security-migration] Added FK fk_admin_audit_target_user -> users(id) ON DELETE SET NULL",
          );
        }
      } catch (err) {
        console.error(
          "[security-migration] Failed to add fk_admin_audit_target_user (non-fatal):",
          err,
        );
      }

      // ════════════════════════════════════════════════════════════════
      // SYSTEM ERROR LOGS - admin-visible capture of console.error calls
      // (Admin > System > Error Logs). Same append-only, id +
      // created_at-indexed shape as admin_audit_log just above; see
      // lib/database/error-log-capture.ts for the console.error
      // interception that writes rows here, and
      // app/api/v3/admin/error-logs/route.ts for the read/clear API.
      // Pruned by lib/database/cleanup.ts like every other log table.
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS system_error_logs (
          id SERIAL PRIMARY KEY,
          message TEXT NOT NULL,
          detail TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_system_error_logs_created_at
          ON system_error_logs(created_at DESC);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify system_error_logs (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify email_logs (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // ADMIN USER NOTES - Admin notes on users
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_user_notes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user ON admin_user_notes(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // DISCORD CONNECTIONS - OAuth integration with Discord
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_discord_user ON discord_connections(user_id);
        CREATE INDEX IF NOT EXISTS idx_discord_id ON discord_connections(discord_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // STAFF ACTIVITY - Real-time admin dashboard activity tracking
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_staff_activity_user_heartbeat ON staff_activity(user_id, last_heartbeat DESC);
        CREATE INDEX IF NOT EXISTS idx_staff_activity_heartbeat ON staff_activity(last_heartbeat DESC);
      `);

      // ════════════════════════════════════════════════════════════════
      // AUTH TOKENS - Password reset & email verification
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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

        CREATE TABLE IF NOT EXISTS billing_verification_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_billing_verify_user ON billing_verification_codes(user_id);
        CREATE INDEX IF NOT EXISTS idx_billing_verify_expires ON billing_verification_codes(expires_at);
      `);

      // ════════════════════════════════════════════════════════════════
      // NOTIFICATION PREFERENCES
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // RATE LIMITING
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) NOT NULL,
          "count" INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(key, window_start)
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
      `);

      // ════════════════════════════════════════════════════════════════
      // DEVICE TRUST - Trusted devices for 2FA
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_device_trust_user_id ON device_trust(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // DATA REQUESTS - GDPR data export
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS data_requests (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          data TEXT,
          requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          downloaded_at TIMESTAMP WITH TIME ZONE
        );
        CREATE INDEX IF NOT EXISTS idx_data_requests_user_id ON data_requests(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // TEAMS
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
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
        CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);
      `);

      // ════════════════════════════════════════════════════════════════
      // ORG-LEVEL RESOURCE SCOPING (AUDIT-010 #273) -- a scan/API key/
      // webhook/schedule can optionally belong to a team instead of only
      // its creating user. Nullable: existing rows and personal (non-team)
      // resources are unaffected. ON DELETE SET NULL, not CASCADE -- a
      // team owner deleting the team must not silently destroy every
      // member's scan history; the resource just reverts to personal.
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        ALTER TABLE scan_history ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_scan_history_team_id ON scan_history(team_id) WHERE team_id IS NOT NULL;

        ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_api_keys_team_id ON api_keys(team_id) WHERE team_id IS NOT NULL;

        ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_webhooks_team_id ON webhooks(team_id) WHERE team_id IS NOT NULL;

        ALTER TABLE scheduled_scans ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_scheduled_scans_team_id ON scheduled_scans(team_id) WHERE team_id IS NOT NULL;
      `);

      // ════════════════════════════════════════════════════════════════
      // GIFTED SUBSCRIPTIONS - Manual plan gifts
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS gifted_subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          gifted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plan VARCHAR(50) NOT NULL,
          reason TEXT,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          revoked_at TIMESTAMP WITH TIME ZONE,
          revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_user ON gifted_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_expires ON gifted_subscriptions(expires_at) WHERE revoked_at IS NULL;
      `);

      // ════════════════════════════════════════════════════════════════
      // ADMIN NOTIFICATIONS - Site-wide notifications
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_cookie ON admin_notifications (cookie_id);

        -- Second, optional action button (e.g. "Add to Chrome" + "Add to Firefox"
        -- on the same notification). Idempotent for databases created before
        -- this pair existed.
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_label_2 VARCHAR(100) DEFAULT NULL;
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_url_2 VARCHAR(500) DEFAULT NULL;
        ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS action_external_2 BOOLEAN DEFAULT false;
      `);

      // ════════════════════════════════════════════════════════════════
      // ACCESS RULES - IP and URL Whitelisting/Blacklisting
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS access_rules (
          id SERIAL PRIMARY KEY,
          rule_type VARCHAR(10) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
          value_type VARCHAR(10) NOT NULL DEFAULT 'ip' CHECK (value_type IN ('ip', 'url')),
          value TEXT NOT NULL,
          description TEXT,
          reason VARCHAR(255),
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_hit_at TIMESTAMP WITH TIME ZONE,
          created_by INTEGER NOT NULL REFERENCES users(id),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMP WITH TIME ZONE,
          is_active BOOLEAN NOT NULL DEFAULT true,
          UNIQUE(rule_type, value_type, value)
        );
CREATE INDEX IF NOT EXISTS idx_access_rules_active ON access_rules(is_active,
          rule_type);
        CREATE INDEX IF NOT EXISTS idx_access_rules_value ON access_rules(value);
        CREATE INDEX IF NOT EXISTS idx_access_rules_type ON access_rules(value_type);
      `);

      // db: self-healing FK on access_rules.created_by. The CREATE TABLE
      // above declares it as NOT NULL REFERENCES users(id) with no
      // ON DELETE clause,
      // which means deleting a user who ever created an access rule
      // fails with an FK violation. We migrate the column to
      // nullable with ON DELETE SET NULL so a user self-delete
      // (`/api/v3/account/delete`) cannot fail.
      try {
        const fkCheck = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.table_constraints
             WHERE table_name = 'access_rules'
               AND constraint_name = 'fk_access_rules_created_by'
           ) AS exists`,
        );
        if (!fkCheck.rows[0]?.exists) {
          // First make the column nullable so ON DELETE SET NULL is legal.
          await pool.query(
            `ALTER TABLE access_rules
               ALTER COLUMN created_by DROP NOT NULL`,
          );
          await pool.query(
            `ALTER TABLE access_rules
               ADD CONSTRAINT fk_access_rules_created_by
               FOREIGN KEY (created_by)
               REFERENCES users(id) ON DELETE SET NULL`,
          );
          console.log(
            "[security-migration] Added FK fk_access_rules_created_by -> users(id) ON DELETE SET NULL",
          );
        }
      } catch (err) {
        console.error(
          "[security-migration] Failed to add fk_access_rules_created_by (non-fatal):",
          err,
        );
      }

      // L-2: self-healing migration for the email_2fa_codes salt
      // column. The original schema was unsalted; we added code_salt
      // as NOT NULL DEFAULT '0' so the CREATE TABLE succeeds against
      // a legacy DB, but the existing rows are still un-salted. Mark
      // them with a sentinel salt and let the cleanup pass delete
      // them within 10 minutes. New rows get a fresh 32-byte salt
      // per-issue.
      try {
        const saltCheck = await pool.query<{ exists: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_name = 'email_2fa_codes' AND column_name = 'code_salt'
           ) AS exists`,
        );
        if (saltCheck.rows[0]?.exists) {
          // Drop any leftover unsalted rows. They're 10-min-TTL so
          // this is safe to do on every boot.
          await pool.query("DELETE FROM email_2fa_codes WHERE code_salt = '0'");
        }
      } catch (err) {
        console.error(
          "[security-migration] Failed to clean up unsalted email_2fa_codes (non-fatal):",
          err,
        );
      }
      // ════════════════════════════════════════════════════════════════
      // SECURITY ALERTS - Monitoring suspicious activity
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
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
      `);

      // ════════════════════════════════════════════════════════════════
      // SYSTEM SETTINGS - Global configuration
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id SERIAL PRIMARY KEY,
          key VARCHAR(100) NOT NULL UNIQUE,
          value TEXT NOT NULL,
          description TEXT,
          setting_type VARCHAR(50) DEFAULT 'string',
          updated_by INTEGER REFERENCES users(id),
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
      `);

      // ════════════════════════════════════════════════════════════════
      // BROADCAST MESSAGES - Mass communication
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS broadcast_messages (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
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
      `);

      // ════════════════════════════════════════════════════════════════
      // BROADCAST RECIPIENTS - Tracking message delivery
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS broadcast_recipients (
          id SERIAL PRIMARY KEY,
          message_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          opened_at TIMESTAMP WITH TIME ZONE,
          clicked_at TIMESTAMP WITH TIME ZONE,
          status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'opened', 'clicked')),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_message ON broadcast_recipients(message_id);
        CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_user ON broadcast_recipients(user_id);
      `);

      // ════════════════════════════════════════════════════════════════
      // SUBDOMAIN CACHE - Caches subdomain discovery results (4 hour TTL)
      // ════════════════════════════════════════════════════════════════
      await pool.query(`
        CREATE TABLE IF NOT EXISTS subdomain_cache (
          domain VARCHAR(255) PRIMARY KEY,
          subdomains JSONB NOT NULL,
          cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_subdomain_cache_cached_at ON subdomain_cache(cached_at);
      `);

      // ════════════════════════════════════════════════════════════════
      // AI CONVERSATIONS - AI chat history (v3)
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
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
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_session_id ON ai_conversations(session_id);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify ai_conversations (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // USER AI CONFIGS - Per-user AI provider settings
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
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
        CREATE INDEX IF NOT EXISTS idx_user_ai_configs_user_id ON user_ai_configs(user_id);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify user_ai_configs (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      await pool
        .query(
          `
        ALTER TABLE user_ai_configs
          ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN NOT NULL DEFAULT FALSE;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add user_ai_configs.ai_disabled (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // USERS v3 columns — email unsubscribe (idempotent via ADD COLUMN IF NOT EXISTS)
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS unsubscribe_token UUID DEFAULT gen_random_uuid(),
          ADD COLUMN IF NOT EXISTS ai_chat_banned BOOLEAN NOT NULL DEFAULT FALSE;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.unsubscribe_token/ai_chat_banned (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // AUDIT-004 v3.1.0 — security hardening columns (idempotent)
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT;
        ALTER TABLE billing_verification_codes
          ADD COLUMN IF NOT EXISTS salt TEXT;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.totp_last_counter / billing_verification_codes.salt (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      // share_token_hash is a generated column — separate statement because
      // PostgreSQL disallows mixing generated and regular columns in one ALTER.
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_token_hash TEXT
          GENERATED ALWAYS AS (encode(sha256(share_token::bytea), 'hex')) STORED;
        CREATE INDEX IF NOT EXISTS idx_scan_history_share_token_hash
          ON scan_history(share_token_hash)
          WHERE share_token_hash IS NOT NULL;
      `,
        )
        .catch(() => {
          // Silently ignore: column may already exist (IF NOT EXISTS is not
          // supported for GENERATED columns in older PG versions; the
          // migration script handles this case for production upgrades).
        });

      // share_expires_at: optional expiry for a share link, set from
      // POST /api/v3/history/[id]/share's `expiresInDays`. NULL means "never
      // expires" (the pre-existing behavior, unchanged for a caller that
      // doesn't pass the field). GET /api/v3/shared/[token] excludes an
      // expired row from its lookup entirely, the same as a revoked
      // (share_token = NULL) one.
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMP WITH TIME ZONE;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_history.share_expires_at (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // BROADCAST MESSAGES - sent_by, tracking who most recently (re)sent a
      // broadcast, distinct from created_by (who authored the draft). The
      // admin UI (components/admin/features/mass-email-manager.tsx) has
      // rendered a "Sent ... by {sent_by_name}" line and the "resend" action
      // handler (app/api/v3/admin/features/route.ts) has written this column
      // since both were built, but the column itself was never added --
      // every resend attempt 500'd on the UPDATE before anything was queued.
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
        ALTER TABLE broadcast_messages
          ADD COLUMN IF NOT EXISTS sent_by INTEGER REFERENCES users(id);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add broadcast_messages.sent_by (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // BROWSER SESSIONS - ownership mapping for IDOR prevention (AUDIT-004#idor-01)
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS browser_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_browser_sessions_user_id ON browser_sessions(user_id);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify browser_sessions (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // SCAN FINDING FEEDBACK - user verdicts for scanner learning
      //
      // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
      // so a fresh `docker compose up` gets this table without an explicit
      // `npm run db:migrate` — every other v3+ table follows the same
      // auto-create-on-boot + explicit-migration dual path.
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify scan_finding_feedback (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(`DROP TABLE IF EXISTS scan_credentials CASCADE;`)
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to drop scan_credentials (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // scan_history.authenticated stays: a plain boolean fact ("this scan
      // ran authenticated") that never held credential material and still
      // doesn't. credential_id pointed at scan_credentials and is dropped
      // along with it.
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS authenticated BOOLEAN NOT NULL DEFAULT false,
          DROP COLUMN IF EXISTS credential_id;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to reconcile scan_history authenticated-scan columns:`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // PERFORMANCE INDEXES (infra audit) — composite indexes for the
      // query shapes actually run on the hot paths (session-scoped scan
      // history listing, per-API-key daily rate limiting, and the admin
      // audit log). The single-column indexes created above each table
      // are left in place; these are additive, not replacements, so
      // unrelated query shapes that only filter on one of the columns
      // keep working the same way.
      //
      // Part of the v2.0.0-to-3.0.0.mjs squashed migration, applied here too
      // so an already-running v3+ deployment picks these up on its next
      // restart without an explicit `npm run db:migrate`.
      // ════════════════════════════════════════════════════════════════
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create performance indexes (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_history background-job columns:`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify user_notifications (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS host_reputation (
          host VARCHAR(255) PRIMARY KEY,
          danger_score INTEGER NOT NULL,
          severity_counts JSONB NOT NULL DEFAULT '{}',
          last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_scan_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_host_reputation_last_scanned
          ON host_reputation(last_scanned_at);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify host_reputation (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS findings JSONB NOT NULL DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS response_headers JSONB;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add host_reputation.findings/response_headers (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS result_meta JSONB NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS authenticated BOOLEAN NOT NULL DEFAULT FALSE;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add host_reputation.result_meta/authenticated (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS scanned_url TEXT;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add host_reputation.scanned_url (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE host_reputation
          ADD COLUMN IF NOT EXISTS auto_tags JSONB NOT NULL DEFAULT '[]';
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add host_reputation.auto_tags (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ALTER COLUMN password_hash DROP NOT NULL,
          ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20);
        UPDATE users SET auth_provider = 'password' WHERE auth_provider IS NULL;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to reconcile users OAuth columns (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        CREATE INDEX IF NOT EXISTS idx_github_connections_user ON github_connections(user_id);
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify github_connections (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS github_review_usage (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          window_start TIMESTAMPTZ NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify github_review_usage (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `ALTER TABLE github_review_usage ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add github_review_usage.window_start (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      await pool
        .query(
          `
        ALTER TABLE github_review_usage
          DROP CONSTRAINT IF EXISTS github_review_usage_user_id_year_month_key;
        ALTER TABLE github_review_usage
          DROP COLUMN IF EXISTS year_month;
        ALTER TABLE github_review_usage
          DROP CONSTRAINT IF EXISTS github_review_usage_user_window_key;
        ALTER TABLE github_review_usage
          ADD CONSTRAINT github_review_usage_user_window_key UNIQUE (user_id, window_start);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to migrate github_review_usage off year_month (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      await pool
        .query(
          `
        DROP INDEX IF EXISTS idx_github_review_usage_user_month;
        CREATE INDEX IF NOT EXISTS idx_github_review_usage_user_window
          ON github_review_usage(user_id, window_start);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to reindex github_review_usage on window_start (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS scan_type VARCHAR(20) NOT NULL DEFAULT 'web';
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_history.scan_type (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS google_id VARCHAR(64) UNIQUE,
          ADD COLUMN IF NOT EXISTS google_email VARCHAR(255),
          ADD COLUMN IF NOT EXISTS google_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS google_avatar_url TEXT,
          ADD COLUMN IF NOT EXISTS github_id VARCHAR(64) UNIQUE,
          ADD COLUMN IF NOT EXISTS github_email VARCHAR(255),
          ADD COLUMN IF NOT EXISTS github_name VARCHAR(255),
          ADD COLUMN IF NOT EXISTS github_avatar_url TEXT;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to reconcile users Google/GitHub link columns (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100),
          ADD COLUMN IF NOT EXISTS discord_avatar_url TEXT,
          ADD COLUMN IF NOT EXISTS discord_email VARCHAR(255);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to reconcile users Discord profile columns (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT true;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_history.is_public (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS scans_private_by_default BOOLEAN NOT NULL DEFAULT false;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.scans_private_by_default (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS cve_kev_cache (
          cache_key VARCHAR(50) PRIMARY KEY,
          cve_ids JSONB NOT NULL,
          cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify cve_kev_cache (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scheduled_scans
          ADD COLUMN IF NOT EXISTS preferred_hour_utc SMALLINT NOT NULL DEFAULT 0
            CHECK (preferred_hour_utc BETWEEN 0 AND 23),
          ADD COLUMN IF NOT EXISTS preferred_day_of_week SMALLINT NOT NULL DEFAULT 1
            CHECK (preferred_day_of_week BETWEEN 0 AND 6),
          ADD COLUMN IF NOT EXISTS preferred_day_of_month SMALLINT NOT NULL DEFAULT 1
            CHECK (preferred_day_of_month BETWEEN 1 AND 28);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scheduled_scans preferred_* columns (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE webhooks
          ADD COLUMN IF NOT EXISTS secret TEXT DEFAULT (
            replace(gen_random_uuid()::text, '-', '') ||
            replace(gen_random_uuid()::text, '-', '')
          );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add webhooks.secret (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify webhook_deliveries (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // EXACT-URL REPUTATION LOOKUP — GET /api/v3/scan/reputation now tries
      // an exact-URL match (lib/scanner/host-reputation.ts's
      // getExactUrlReputation) before falling back to the host-level
      // aggregate, so a scan of one page on a host (e.g. one GitHub repo)
      // no longer gets shown as the reputation of every other unrelated
      // page on that same host. That lookup runs on every popup open for
      // every page a user visits, so it needs an index -- partial, scoped
      // to exactly the WHERE clause the query uses, so it stays small and
      // never indexes a private or incomplete scan that could never match.
      await pool
        .query(
          `
        CREATE INDEX IF NOT EXISTS idx_scan_history_url_public_completed
          ON scan_history(url)
          WHERE is_public = true AND status = 'completed';
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create idx_scan_history_url_public_completed (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS ai_usage (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          window_start TIMESTAMPTZ NOT NULL,
          tokens_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, window_start)
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify ai_usage (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scan_tags
          ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'user'
            CHECK (source IN ('auto', 'user', 'ai'));
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_tags.source (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scan_tags DROP CONSTRAINT IF EXISTS scan_tags_source_check;
        ALTER TABLE scan_tags ADD CONSTRAINT scan_tags_source_check
          CHECK (source IN ('auto', 'user', 'ai'));
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to widen scan_tags_source_check (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify auto_tag_dismissals (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE scan_history
          ADD COLUMN IF NOT EXISTS share_publicly_listed BOOLEAN NOT NULL DEFAULT false;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add scan_history.share_publicly_listed (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS share_publicly_listed_by_default BOOLEAN NOT NULL DEFAULT true;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.share_publicly_listed_by_default (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS pre_staff_plan VARCHAR(50);
        UPDATE users
          SET pre_staff_plan = COALESCE(plan, 'free'), plan = 'pro_supporter'
          WHERE role IN ('admin', 'moderator', 'support')
            AND COALESCE(plan, 'free') IN ('free', 'core_supporter', 'pro_supporter')
            AND pre_staff_plan IS NULL;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add/backfill users.pre_staff_plan (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ════════════════════════════════════════════════════════════════
      // SUPER_ADMIN BOOTSTRAP - the first registered account
      //
      // super_admin is deliberately un-assignable through the admin panel
      // (app/api/v3/admin/route.ts's set_role -- see STAFF_ROLES in
      // lib/rate-limiting/daily-limits.ts) since it gates real code
      // execution on the host (the self-updater, see
      // app/api/v3/admin/updater/apply/route.ts). On a self-hosted
      // deployment that leaves no UI path to ever gain it -- someone would
      // have to hand-edit the database. Instead: if the users table has NO
      // super_admin yet, promote the lowest-id row (the very first account
      // ever registered on this instance) automatically on boot. A no-op
      // forever after that first promotion, even if that user is later
      // demoted or deleted -- this only ever fires once per instance.
      //
      // lib/billing/staff-plan.ts's syncPlanForRoleChange also grants the
      // promoted account elite_supporter (super_admin's plan tier, above
      // the pro_supporter the rest of staff get), the same real,
      // non-Stripe grant/revoke bookkeeping (pre_staff_plan) every other
      // staff promotion uses.
      // ════════════════════════════════════════════════════════════════
      try {
        const existingSuperAdmin = await pool.query(
          "SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1",
        );
        if (existingSuperAdmin.rowCount === 0) {
          const firstUser = await pool.query<{
            id: number;
            role: string | null;
          }>("SELECT id, role FROM users ORDER BY id ASC LIMIT 1");
          const row = firstUser.rows[0];
          if (row) {
            await pool.query(
              "UPDATE users SET role = 'super_admin', updated_at = NOW() WHERE id = $1",
              [row.id],
            );
            const { syncPlanForRoleChange } =
              await import("./lib/billing/staff-plan");
            await syncPlanForRoleChange(row.id, row.role, "super_admin");
            console.log(
              `[${APP_NAME}] Bootstrapped user #${row.id} as super_admin (first account, none existed yet).`,
            );
          }
        }
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to bootstrap super_admin (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      }

      // ── Staff plan reconciliation ───────────────────────────────────
      // Self-heals any staff role assigned by directly editing users.role
      // in the database (e.g. hand-run SQL to grant super_admin on an
      // existing account) -- see lib/billing/staff-plan.ts's
      // reconcileStaffPlans for why that bypasses the real plan grant.
      // Runs every boot; fully idempotent/no-op once already reconciled.
      try {
        const { reconcileStaffPlans } =
          await import("./lib/billing/staff-plan");
        const reconciled = await reconcileStaffPlans();
        if (reconciled > 0) {
          console.log(
            `[${APP_NAME}] Reconciled staff plan grant for ${reconciled} account(s) promoted outside the admin panel.`,
          );
        }
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to reconcile staff plans (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      }

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS ai_credit_balance BIGINT NOT NULL DEFAULT 0;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.ai_credit_balance (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS github_credit_balance BIGINT NOT NULL DEFAULT 0;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.github_credit_balance (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS free_github_review_used_at TIMESTAMPTZ;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.free_github_review_used_at (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `ALTER TABLE broadcast_messages ALTER COLUMN created_by DROP NOT NULL;`,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to drop NOT NULL on broadcast_messages.created_by (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });
      await pool
        .query(
          `
        ALTER TABLE broadcast_messages
          DROP CONSTRAINT IF EXISTS broadcast_messages_created_by_fkey;
        ALTER TABLE broadcast_messages
          ADD CONSTRAINT broadcast_messages_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to widen broadcast_messages.created_by FK to ON DELETE SET NULL (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        CREATE INDEX IF NOT EXISTS idx_promoted_auto_tag_rules_tag ON promoted_auto_tag_rules(tag);
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify promoted_auto_tag_rules (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS ai_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tokens BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify ai_credit_purchases (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS github_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          tokens BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify github_credit_purchases (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS browserbase_credit_seconds_balance BIGINT NOT NULL DEFAULT 0;
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add users.browserbase_credit_seconds_balance (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS browserbase_usage (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          period_start TIMESTAMPTZ NOT NULL,
          seconds_used INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, period_start)
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify browserbase_usage (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      await pool
        .query(
          `
        CREATE TABLE IF NOT EXISTS browserbase_credit_purchases (
          payment_intent_id VARCHAR(255) PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          seconds BIGINT NOT NULL,
          credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify browserbase_credit_purchases (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

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
      await pool
        .query(
          `
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
        CREATE INDEX IF NOT EXISTS idx_domains_user_id ON domains(user_id);
        CREATE INDEX IF NOT EXISTS idx_domains_team_id ON domains(team_id) WHERE team_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_domains_domain_verified ON domains(domain) WHERE status = 'verified';
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify domains (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      console.log(`[${APP_NAME}] Database schema verified successfully.`);

      // ── Seed Default Badges ─────────────────────────────────────
      try {
        await pool.query(`
          INSERT INTO badges (name, display_name, description, icon, color, priority, is_limited)
          VALUES 
            ('beta_tester', 'Beta Tester', 'Early beta program participant', 'flask', '#10b981', 10, true),
            ('early_supporter', 'Early Supporter', 'Supported the project early on', 'heart', '#ec4899', 9, true),
            ('founder', 'Founder', 'Original founding member', 'crown', '#f59e0b', 20, true),
            ('contributor', 'Contributor', 'Open source contributor', 'code', '#8b5cf6', 8, false),
            ('bug_hunter', 'Bug Hunter', 'Found and reported bugs', 'bug', '#ef4444', 7, false),
            ('verified', 'Verified', 'Verified account', 'badge-check', '#3b82f6', 5, false),
            ('premium', 'Premium', 'Premium subscription member', 'star', '#fbbf24', 6, false),
            ('staff', 'Staff', 'VulnRadar team member', 'shield', '#6366f1', 15, true)
          ON CONFLICT (name) DO NOTHING;
        `);
        console.log(`[${APP_NAME}] Default badges seeded.`);
      } catch (seedError) {
        console.error(
          `[${APP_NAME}] Failed to seed badges (non-fatal):`,
          seedError,
        );
      }

      // ── Run initial cleanup ───────────────────────────────────────
      try {
        const { performDatabaseCleanup, formatCleanupStats } =
          await import("./lib/database/cleanup");
        const stats = await performDatabaseCleanup();
        console.log(
          `[${APP_NAME}] Initial cleanup completed: ${formatCleanupStats(stats)}`,
        );
      } catch (cleanupError) {
        console.error(
          `[${APP_NAME}] Initial cleanup failed (non-fatal):`,
          cleanupError,
        );
      }

      // ── Schedule periodic cleanup ─────────────────────────────────
      // In-process cleanup runs every 5 minutes. The shortest
      // meaningful user-facing TTL is email_2fa_codes (10 min), so 5
      // min cadence keeps stale entries from lingering more than
      // halfway through their next scheduled run. The in-process
      // setInterval only fires in long-lived deployments (Node,
      // Docker, self-hosted); for serverless deployments the cleanup
      // job won't run — accept that limitation. Staff can also force
      // a run from the admin UI: POST /api/v3/admin/cleanup.
      try {
        const { schedulePeriodicCleanup } =
          await import("./lib/database/cleanup");
        schedulePeriodicCleanup(5 * 60 * 1000); // 5 min
        console.log(
          `[${APP_NAME}] Scheduled periodic database cleanup (5min interval).`,
        );
      } catch (scheduleError) {
        console.error(
          `[${APP_NAME}] Failed to schedule periodic cleanup:`,
          scheduleError,
        );
      }

      // ── Schedule the scheduled-scans worker ──────────────────────
      // Polls scheduled_scans for anything due every
      // CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS (2 min by default) rather
      // than trying to align exactly with each schedule's own frequency --
      // same "poll on a short fixed cadence, not per-row timers" approach
      // as the cleanup job above. See lib/scanner/scheduled-scans-worker.ts
      // for the claim/concurrency/notification design.
      try {
        const { schedulePeriodicScheduledScans } =
          await import("./lib/scanner/scheduled-scans-worker");
        schedulePeriodicScheduledScans();
        console.log(`[${APP_NAME}] Scheduled the scheduled-scans worker.`);
      } catch (scheduleError) {
        console.error(
          `[${APP_NAME}] Failed to schedule the scheduled-scans worker:`,
          scheduleError,
        );
      }

      // ── Posture digest: schema + periodic worker ──────────────────
      // ensureDigestSchema() adds users.digest_email_enabled/
      // last_digest_sent_at and notification_preferences.email_posture_digest
      // (additive, self-healing) before the worker's first poll tick can
      // reference them. See lib/notifications/posture-digest.ts.
      try {
        const { ensureDigestSchema } =
          await import("./lib/notifications/digest-schema");
        await ensureDigestSchema();
        const { schedulePeriodicPostureDigest } =
          await import("./lib/notifications/posture-digest");
        schedulePeriodicPostureDigest();
        console.log(`[${APP_NAME}] Scheduled the posture-digest worker.`);
      } catch (scheduleError) {
        console.error(
          `[${APP_NAME}] Failed to schedule the posture-digest worker:`,
          scheduleError,
        );
      }

      // ── Scheduled database backups ──────────────────────────────────
      // Off by default (SCHEDULED_BACKUP_ENABLED, see registry.ts) -- the
      // timer is always registered so flipping the setting on takes effect
      // on the next tick without a restart, same as posture digests above.
      // See lib/backup/scheduled-backup-worker.ts.
      try {
        const { schedulePeriodicBackup } =
          await import("./lib/backup/scheduled-backup-worker");
        schedulePeriodicBackup();
        console.log(`[${APP_NAME}] Scheduled the periodic backup worker.`);
      } catch (scheduleError) {
        console.error(
          `[${APP_NAME}] Failed to schedule the periodic backup worker:`,
          scheduleError,
        );
      }

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
      await pool
        .query(
          `
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
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to create/verify host_badges (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // badge_token_hash is a generated column -- separate statement, same
      // reason as scan_history.share_token_hash above (PostgreSQL disallows
      // mixing generated and regular columns in one ALTER, and IF NOT
      // EXISTS is unsupported for generated columns on older PG versions).
      await pool
        .query(
          `
        ALTER TABLE host_badges
          ADD COLUMN IF NOT EXISTS badge_token_hash TEXT
          GENERATED ALWAYS AS (encode(sha256(badge_token::bytea), 'hex')) STORED;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_host_badges_token_hash
          ON host_badges(badge_token_hash);
      `,
        )
        .catch(() => {
          // Silently ignore: column may already exist (see the
          // share_token_hash comment above for why this can't use a normal
          // error log).
        });

      // scope controls whose scans a badge resolves against: 'user' (the
      // default, matching the original behavior) only ever shows the badge
      // owner's own scans of that URL; 'global' shows whichever completed
      // scan of that URL is newest, by anyone. Owner-toggleable, off by
      // default so a badge never starts pulling in a stranger's scan data
      // without the owner opting in. See app/api/v3/badge/[token]/route.ts
      // and app/api/v3/shared/[token]/route.ts for how the JOIN branches on
      // this, and app/api/v3/badge/site/route.ts's PATCH handler for the
      // toggle itself.
      await pool
        .query(
          `
        ALTER TABLE host_badges
          ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'user'
          CHECK (scope IN ('user', 'global'));
      `,
        )
        .catch((err) => {
          console.error(
            `[${APP_NAME}] Failed to add host_badges.scope (non-fatal):`,
            err instanceof Error ? err.message : err,
          );
        });

      // ── Stale scan sweep (safety net) ─────────────────────────────
      // Runs once at boot. Fails any scan left `pending`/`running` by a
      // PREVIOUS process (killed by a deploy, OOM, crash) -- see
      // lib/scanner/scan-jobs.ts's sweepStaleScans for why the in-memory
      // watchdog alone can't cover this case.
      try {
        const { sweepStaleScans } = await import("./lib/scanner/scan-jobs");
        const swept = await sweepStaleScans();
        if (swept > 0) {
          console.error(
            `[${APP_NAME}] Failed ${swept} scan(s) left running/pending by a previous process.`,
          );
          const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
          void sendAdminAlert({
            event: "stale_scans_swept",
            severity: "warning",
            message: `${swept} scan(s) were left running/pending by a previous process (an unclean restart) and have been marked failed.`,
            context: { count: swept },
          });
        }
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to sweep stale scans (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      }

      // ── Required-table verification (safety net) ──────────────────
      // Runs once at boot, after every CREATE TABLE/ALTER TABLE block above
      // has had its chance to run. Each of those blocks only console.errors
      // and continues on failure (so one transient hiccup doesn't take the
      // whole boot sequence down), which means schema_version can say
      // "ready" while a table that sequence was supposed to create doesn't
      // actually exist. /api/v3/health checks this same list on every
      // poll; this fires a one-time alert at boot instead of paging on
      // every single health-check poll thereafter (AUDIT-010,
      // production-readiness #3).
      try {
        const { REQUIRED_TABLES } =
          await import("./lib/database/required-tables");
        const tablesRes = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
          [REQUIRED_TABLES],
        );
        const present = new Set(tablesRes.rows.map((r) => r.table_name));
        const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
        if (missing.length > 0) {
          console.error(
            `[${APP_NAME}] Boot completed but required table(s) are missing:`,
            missing.join(", "),
          );
          const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
          void sendAdminAlert({
            event: "boot_required_tables_missing",
            severity: "critical",
            message: `${APP_NAME} booted but ${missing.length} required table(s) are missing: ${missing.join(", ")}. Some routes will fail until this is fixed.`,
            context: { missingTables: missing },
          });
        }
      } catch (err) {
        console.error(
          `[${APP_NAME}] Failed to verify required tables (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      }

      // ── Sequence repair (safety net) ─────────────────────────────
      // Runs last on every startup. Detects and fixes any SERIAL sequences
      // that fell behind MAX(id) — e.g. after a bulk import, seed, or
      // explicit-ID insert that bypassed the migration tool. Only logs
      // when something was actually broken and fixed.
      try {
        const seqRes = await pool.query<{
          seq_name: string;
          tbl_name: string;
          col_name: string;
          last_value: string | null;
        }>(`
          SELECT
            s.relname                     AS seq_name,
            t.relname                     AS tbl_name,
            a.attname                     AS col_name,
            pg_sequence_last_value(s.oid) AS last_value
          FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid
            AND d.classid    = 'pg_class'::regclass
            AND d.refclassid = 'pg_class'::regclass
            AND d.deptype    = 'a'
          JOIN pg_class t ON t.oid = d.refobjid
          JOIN pg_attribute a
            ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          WHERE s.relkind = 'S'
            AND t.relnamespace = (
              SELECT oid FROM pg_namespace WHERE nspname = 'public'
            )
        `);

        const fixed: string[] = [];

        for (const row of seqRes.rows) {
          const maxRes = await pool.query<{ max_val: string | null }>(
            `SELECT MAX("${row.col_name}") AS max_val FROM "${row.tbl_name}"`,
          );
          const maxVal =
            maxRes.rows[0]?.max_val != null
              ? parseInt(maxRes.rows[0].max_val, 10)
              : 0;
          const seqVal =
            row.last_value != null ? parseInt(row.last_value, 10) : 0;

          if (maxVal > 0 && maxVal > seqVal) {
            await pool.query(`SELECT setval($1, $2)`, [row.seq_name, maxVal]);
            fixed.push(`${row.tbl_name} (was ${seqVal}, fixed to ${maxVal})`);
          }
        }

        if (fixed.length > 0) {
          console.log(
            `[${APP_NAME}] Sequence repair: fixed ${fixed.length} table(s) — ${fixed.join("; ")}`,
          );
        }
      } catch (seqErr) {
        console.error(
          `[${APP_NAME}] Sequence repair failed (non-fatal):`,
          seqErr,
        );
      }

      // ── Graceful shutdown ─────────────────────────────────────────
      const gracefulShutdown = async () => {
        try {
          await pool.end();
          console.log(`[${APP_NAME}] Database pool closed on shutdown.`);
        } catch (err) {
          console.error(`[${APP_NAME}] Error closing database pool:`, err);
        }
      };
      process.on("SIGTERM", gracefulShutdown);
      process.on("SIGINT", gracefulShutdown);
    } catch (error) {
      // A failure partway through this block (CREATE TABLE IF NOT EXISTS /
      // ALTER TABLE ADD COLUMN IF NOT EXISTS, hundreds of statements) used to
      // just log and fall through, leaving the app to boot and serve traffic
      // against a database that might be missing a table or column a later
      // statement in this same block would have created. Match the schema
      // version checks above: alert, then refuse to serve traffic on a
      // database this process cannot vouch for (AUDIT-010, prodready-07).
      console.error(
        `[${APP_NAME}] Database schema creation/migration failed:`,
        error,
      );
      const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
      await sendAdminAlert({
        event: "boot_schema_creation_failed",
        severity: "critical",
        message: `${APP_NAME} failed to start: schema creation/migration errored partway through. The database may be left partially initialized. Run npm run db:migrate, or npm run db:diagnose to inspect the current state.`,
      });
      process.exit(1);
    }
  }
}
