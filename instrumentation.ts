/**
 * Database initialization and schema management
 * Runs on server startup to ensure all required tables exist
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { default: pool } = await import("./lib/db")
    const { APP_NAME, APP_VERSION, ENGINE_VERSION, VERSION_CHECK_URL, RELEASES_URL } = await import("./lib/constants")

    // ── Startup version check (logs to server console) ───────────
    console.log(`\x1b[36m[${APP_NAME}]\x1b[0m Starting ${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`)
    try {
      const vRes = await fetch(VERSION_CHECK_URL, {
        signal: AbortSignal.timeout(5000),
        headers: { "Accept": "application/vnd.github+json" },
      })
      if (vRes.ok) {
        const release = await vRes.json()
        const tagName = (release.tag_name as string) || ""
        const latest = tagName.replace(/^v/, "")
        const releaseUrl = (release.html_url as string) || `${RELEASES_URL}/tag/${tagName}`
        const cur = APP_VERSION.split(".").map(Number)
        const lat = latest.split(".").map(Number)

        let status: "current" | "behind" | "ahead" = "current"
        for (let i = 0; i < 3; i++) {
          if ((cur[i] || 0) > (lat[i] || 0)) { status = "ahead"; break }
          if ((cur[i] || 0) < (lat[i] || 0)) { status = "behind"; break }
        }

        if (status === "current") {
          console.log(`\x1b[32m[${APP_NAME}]\x1b[0m You're running the latest version (v${APP_VERSION}).`)
        } else if (status === "behind") {
          console.log(`\x1b[33m[${APP_NAME}]\x1b[0m Update available! You're on v${APP_VERSION}, latest is v${latest}.`)
          console.log(`\x1b[33m[${APP_NAME}]\x1b[0m ${releaseUrl}`)
        } else {
          const msgs = [
            "Whoa, you're running a version from the future! Can you tell us if we ever fix that one CSS bug?",
            "Nice try, time traveler. What's the stock market doing in your timeline?",
            "You're ahead of us... literally. Did the robots take over yet?",
            "Running unreleased code? You absolute legend.",
            "You're living in the future and we're still fixing merge conflicts.",
            "Hold up, this version doesn't exist yet. Are you a wizard?",
          ]
          console.log(`\x1b[35m[${APP_NAME}]\x1b[0m Running v${APP_VERSION}, but latest release is v${latest}.`)
          console.log(`\x1b[35m[${APP_NAME}]\x1b[0m ${msgs[Math.floor(Math.random() * msgs.length)]}`)
        }
      }
    } catch {
      console.log(`\x1b[90m[${APP_NAME}]\x1b[0m Could not check for updates. Running v${APP_VERSION}.`)
    }

    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
      console.error(
        `[${APP_NAME}] DATABASE_URL is not configured. Database initialization skipped. Please set DATABASE_URL in your environment variables.`,
      )
      return
    }

    try {
      // ── Users ─────────────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          role VARCHAR(20) NOT NULL DEFAULT 'user',
          avatar_url TEXT,
          tos_accepted_at TIMESTAMP WITH TIME ZONE,
          email_verified_at TIMESTAMP WITH TIME ZONE,
          disabled_at TIMESTAMP WITH TIME ZONE,
          onboarding_completed BOOLEAN NOT NULL DEFAULT false,
          totp_secret VARCHAR(255),
          totp_enabled BOOLEAN NOT NULL DEFAULT false,
          two_factor_method VARCHAR(10),
          backup_codes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      `)

      // ── Sessions ──────────────────────────────────────────────────
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
      `)

      // ── API Keys ──────────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key_hash VARCHAR(255) NOT NULL UNIQUE,
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
      `)

      // ── API Usage ─────────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_usage (
          id SERIAL PRIMARY KEY,
          api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at);
      `)

      // ── Scan History ──────────────────────────────────────────────
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
      `)

      // ── Scan Tags ─────────────────────────────────────────────────
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
        CREATE INDEX IF NOT EXISTS idx_scan_tags_tag ON scan_tags(tag);
      `)

      // ── Webhooks ──────────────────────────────────────────────────
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
      `)

      // ── Scheduled Scans ───────────────────────────────────────────
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
      `)

      // ── Data Requests ─────────────────────────────────────────────
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
      `)

      // ── Admin Audit Log ───────────────────────────────────────────
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
      `)

      // ── Password Reset Tokens ─────────────────────────────────────
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
        CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id);
      `)

      // ── Email Verification Tokens ─────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_evt_token_hash ON email_verification_tokens(token_hash);
        CREATE INDEX IF NOT EXISTS idx_evt_user_id ON email_verification_tokens(user_id);
      `)

      // ── Notification Preferences (19 categories) ──────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          email_security BOOLEAN NOT NULL DEFAULT true,
          email_new_login BOOLEAN NOT NULL DEFAULT true,
          email_password_change BOOLEAN NOT NULL DEFAULT true,
          email_2fa_change BOOLEAN NOT NULL DEFAULT true,
          email_session_revoked BOOLEAN NOT NULL DEFAULT true,
          email_scan_complete BOOLEAN NOT NULL DEFAULT true,
          email_critical_findings BOOLEAN NOT NULL DEFAULT true,
          email_regression_alert BOOLEAN NOT NULL DEFAULT true,
          email_api_keys BOOLEAN NOT NULL DEFAULT true,
          email_api_limit_warning BOOLEAN NOT NULL DEFAULT true,
          email_webhooks BOOLEAN NOT NULL DEFAULT true,
          email_webhook_failure BOOLEAN NOT NULL DEFAULT true,
          email_schedules BOOLEAN NOT NULL DEFAULT true,
          email_data_requests BOOLEAN NOT NULL DEFAULT true,
          email_account_deletion BOOLEAN NOT NULL DEFAULT true,
          email_team_invite BOOLEAN NOT NULL DEFAULT true,
          email_team_changes BOOLEAN NOT NULL DEFAULT true,
          email_product_updates BOOLEAN NOT NULL DEFAULT true,
          email_tips_guides BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences(user_id);
      `)

      // ── Email 2FA Codes ───────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_2fa_codes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          code_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_email_2fa_user ON email_2fa_codes(user_id);
      `)

      // ── Rate Limiting ─────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) NOT NULL,
          "count" INTEGER NOT NULL DEFAULT 1,
          window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
          UNIQUE(key, window_start)
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
        CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
      `)

      // ── Device Trust ──────────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS device_trust (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_fingerprint VARCHAR(255) NOT NULL,
          device_name VARCHAR(255),
          ip_address VARCHAR(45),
          user_agent TEXT,
          last_used_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
          UNIQUE(user_id, device_fingerprint)
        );
        CREATE INDEX IF NOT EXISTS idx_device_trust_user_id ON device_trust(user_id);
        CREATE INDEX IF NOT EXISTS idx_device_trust_expires_at ON device_trust(expires_at);
      `)

      // ── Teams ─────────────────────────────────────────────────────
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
        CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
      `)

      // ── Subscriptions & Billing (v2.0) ────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          stripe_customer_id VARCHAR(255) UNIQUE,
          stripe_subscription_id VARCHAR(255) UNIQUE,
          plan VARCHAR(50) NOT NULL DEFAULT 'free',
          status VARCHAR(50) NOT NULL DEFAULT 'active',
          current_period_start TIMESTAMP WITH TIME ZONE,
          current_period_end TIMESTAMP WITH TIME ZONE,
          cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan);
      `)

      // ── Daily Request Limits (v2.0) ───────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS daily_request_limits (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          date DATE NOT NULL DEFAULT CURRENT_DATE,
          request_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(user_id, date)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_limits_user_date ON daily_request_limits(user_id, date);
      `)

      // ── Roles & Permissions (v2.0) ────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) NOT NULL UNIQUE,
          display_name VARCHAR(100) NOT NULL,
          description TEXT,
          color VARCHAR(20),
          priority INTEGER NOT NULL DEFAULT 0,
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
        CREATE INDEX IF NOT EXISTS idx_roles_priority ON roles(priority);

        CREATE TABLE IF NOT EXISTS permissions (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          display_name VARCHAR(150) NOT NULL,
          description TEXT,
          category VARCHAR(50),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
        CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);

        CREATE TABLE IF NOT EXISTS role_permissions (
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
          PRIMARY KEY (role_id, permission_id)
        );
        CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

        CREATE TABLE IF NOT EXISTS user_roles (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (user_id, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

        CREATE TABLE IF NOT EXISTS user_permission_tags (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
          tag_role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_user_permission_tags_user ON user_permission_tags(user_id);
      `)

      // ── Beta Mode (v2.0) ──────────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS beta_features (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          description TEXT,
          enabled BOOLEAN NOT NULL DEFAULT false,
          rollout_percentage INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_beta_features_name ON beta_features(name);

        CREATE TABLE IF NOT EXISTS user_beta_access (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          feature_id INTEGER NOT NULL REFERENCES beta_features(id) ON DELETE CASCADE,
          granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          PRIMARY KEY (user_id, feature_id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_beta_user ON user_beta_access(user_id);
      `)

      // ── Billing History (v2.0) ────────────────────────────────────
      await pool.query(`
        CREATE TABLE IF NOT EXISTS billing_history (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stripe_invoice_id VARCHAR(255) UNIQUE,
          amount_cents INTEGER NOT NULL,
          currency VARCHAR(10) NOT NULL DEFAULT 'usd',
          status VARCHAR(50) NOT NULL,
          description TEXT,
          invoice_pdf_url TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id);
        CREATE INDEX IF NOT EXISTS idx_billing_history_created ON billing_history(created_at);
      `)

      console.log(`[${APP_NAME}] Database schema verified successfully.`)

      // ── Seed Default Roles & Permissions ──────────────────────────
      try {
        // Insert default roles if they don't exist
        await pool.query(`
          INSERT INTO roles (name, display_name, description, color, priority, is_system)
          VALUES 
            ('user', 'User', 'Standard user with basic access', NULL, 0, true),
            ('beta_tester', 'Beta Tester', 'Access to beta features and early releases', '#10b981', 1, true),
            ('support', 'Support', 'Customer support team member', '#3b82f6', 2, true),
            ('moderator', 'Moderator', 'Content and user moderation access', '#f59e0b', 3, true),
            ('admin', 'Admin', 'Full administrative access', '#ef4444', 4, true)
          ON CONFLICT (name) DO NOTHING;
        `)

        // Insert default permissions if they don't exist
        await pool.query(`
          INSERT INTO permissions (name, display_name, description, category)
          VALUES 
            ('scan.create', 'Create Scans', 'Ability to run security scans', 'scanning'),
            ('scan.view', 'View Scans', 'Ability to view scan results', 'scanning'),
            ('scan.delete', 'Delete Scans', 'Ability to delete scan history', 'scanning'),
            ('scan.bulk', 'Bulk Scanning', 'Ability to run bulk scans', 'scanning'),
            ('api.access', 'API Access', 'Ability to use the API', 'api'),
            ('api.keys.create', 'Create API Keys', 'Ability to create API keys', 'api'),
            ('webhook.manage', 'Manage Webhooks', 'Ability to create and manage webhooks', 'integrations'),
            ('schedule.manage', 'Manage Schedules', 'Ability to create scheduled scans', 'integrations'),
            ('team.create', 'Create Teams', 'Ability to create teams', 'teams'),
            ('team.manage', 'Manage Teams', 'Ability to manage team members', 'teams'),
            ('admin.users.view', 'View Users', 'View all users in admin panel', 'admin'),
            ('admin.users.edit', 'Edit Users', 'Edit user details and roles', 'admin'),
            ('admin.users.delete', 'Delete Users', 'Delete user accounts', 'admin'),
            ('admin.scans.view', 'View All Scans', 'View all scans across users', 'admin'),
            ('admin.audit.view', 'View Audit Log', 'View admin audit log', 'admin'),
            ('admin.settings', 'System Settings', 'Access to system settings', 'admin'),
            ('beta.access', 'Beta Access', 'Access to beta features', 'beta')
          ON CONFLICT (name) DO NOTHING;
        `)

        // Assign permissions to roles
        await pool.query(`
          WITH role_perms AS (
            SELECT r.id as role_id, p.id as permission_id
            FROM roles r, permissions p
            WHERE 
              (r.name = 'user' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'api.access', 'api.keys.create'))
              OR (r.name = 'beta_tester' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'scan.bulk', 'api.access', 'api.keys.create', 'webhook.manage', 'schedule.manage', 'beta.access'))
              OR (r.name = 'support' AND p.name IN ('scan.create', 'scan.view', 'api.access', 'admin.users.view', 'admin.scans.view'))
              OR (r.name = 'moderator' AND p.name IN ('scan.create', 'scan.view', 'scan.delete', 'scan.bulk', 'api.access', 'api.keys.create', 'admin.users.view', 'admin.users.edit', 'admin.scans.view', 'admin.audit.view'))
              OR (r.name = 'admin' AND p.name IS NOT NULL)
          )
          INSERT INTO role_permissions (role_id, permission_id)
          SELECT role_id, permission_id FROM role_perms
          ON CONFLICT (role_id, permission_id) DO NOTHING;
        `)

        console.log(`[${APP_NAME}] Default roles and permissions seeded.`)
      } catch (seedError) {
        console.error(`[${APP_NAME}] Failed to seed roles/permissions (non-fatal):`, seedError)
      }

      // Run initial cleanup on startup
      try {
        const { performDatabaseCleanup, formatCleanupStats } = await import("./lib/cleanup")
        const stats = await performDatabaseCleanup()
        console.log(`[${APP_NAME}] Initial cleanup completed: ${formatCleanupStats(stats)}`)
      } catch (cleanupError) {
        console.error(`[${APP_NAME}] Initial cleanup failed (non-fatal):`, cleanupError)
      }

      // Schedule periodic cleanup every 24 hours
      try {
        const { schedulePeriodicCleanup } = await import("./lib/cleanup")
        schedulePeriodicCleanup(5000)
        console.log(`[${APP_NAME}] Scheduled periodic database cleanup (every 24 hours).`)
      } catch (scheduleError) {
        console.error(`[${APP_NAME}] Failed to schedule periodic cleanup:`, scheduleError)
      }

      // Set up graceful shutdown to close pool on process termination
      const gracefulShutdown = async () => {
        try {
          await pool.end()
          console.log(`[${APP_NAME}] Database pool closed on shutdown.`)
        } catch (err) {
          console.error(`[${APP_NAME}] Error closing database pool:`, err)
        }
      }
      process.on("SIGTERM", gracefulShutdown)
      process.on("SIGINT", gracefulShutdown)
    } catch (error) {
      console.error(`[${APP_NAME}] Database migration failed:`, error)
    }
    // Do NOT call pool.end() here - the pool must stay open for the application's lifetime
    // The pool will be closed when the application shuts down via graceful shutdown handlers
  }
}
