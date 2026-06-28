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
        process.exit(1);
      }

      console.log(
        `[${APP_NAME}] Schema version: v${dbSchema} (required: v${MIN_SCHEMA_VERSION}) ✓`,
      );
    } catch (schemaError) {
      console.error(`[${APP_NAME}] Schema version check failed:`, schemaError);
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
          priority INTEGER NOT NULL DEFAULT 0,
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_active ON admin_notifications (is_active, starts_at, ends_at) WHERE is_active = true;
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications (type);
        CREATE INDEX IF NOT EXISTS idx_admin_notifications_cookie ON admin_notifications (cookie_id);
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
      try {
        const { schedulePeriodicCleanup } =
          await import("./lib/database/cleanup");
        schedulePeriodicCleanup(5000);
        console.log(`[${APP_NAME}] Scheduled periodic database cleanup.`);
      } catch (scheduleError) {
        console.error(
          `[${APP_NAME}] Failed to schedule periodic cleanup:`,
          scheduleError,
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
      console.error(`[${APP_NAME}] Database migration failed:`, error);
    }
  }
}
