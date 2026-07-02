/**
 * VulnRadar v2 schema snapshot.
 * Frozen at v2.0.0 — used by `npm run db:create` when targeting a v2 database.
 * DO NOT EDIT — update instrumentation.ts and bump MIN_SCHEMA_VERSION instead.
 *
 * The create-fresh-db script parses `await pool.query(...)` blocks from this
 * file as text; it never imports or executes it.
 */
export async function register() {
  const pool = { query: async (_sql: string) => {} };

  // ── USERS ────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      avatar_url TEXT,
      discord_id VARCHAR(64) UNIQUE,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      plan VARCHAR(50) NOT NULL DEFAULT 'free',
      stripe_customer_id VARCHAR(255) UNIQUE,
      stripe_subscription_id VARCHAR(255) UNIQUE,
      subscription_status VARCHAR(50) DEFAULT NULL,
      current_period_end TIMESTAMP WITH TIME ZONE,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      beta_access BOOLEAN NOT NULL DEFAULT false,
      daily_scan_limit INTEGER DEFAULT NULL,
      email_verified_at TIMESTAMP WITH TIME ZONE,
      tos_accepted_at TIMESTAMP WITH TIME ZONE,
      disabled_at TIMESTAMP WITH TIME ZONE,
      onboarding_completed BOOLEAN NOT NULL DEFAULT false,
      totp_secret VARCHAR(255),
      totp_enabled BOOLEAN NOT NULL DEFAULT false,
      two_factor_method VARCHAR(10),
      backup_codes TEXT,
      email_session_revoked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)
  `);

  // ── SESSIONS ─────────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)
  `);

  // ── API KEYS ──────────────────────────────────────────────────────────
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
      WHERE key_locator IS NULL
  `);

  // ── API USAGE ─────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id SERIAL PRIMARY KEY,
      api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(api_key_id);
    CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at)
  `);

  // ── SCAN HISTORY ──────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_scan_history_share_token ON scan_history(share_token)
  `);

  // ── SCAN TAGS ─────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_tags (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
      tag VARCHAR(50) NOT NULL,
      UNIQUE(scan_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_scan_tags_scan_id ON scan_tags(scan_id);
    CREATE INDEX IF NOT EXISTS idx_scan_tags_user_id ON scan_tags(user_id)
  `);

  // ── SCHEDULED SCANS ───────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_scheduled_scans_next_run ON scheduled_scans(next_run_at)
  `);

  // ── WEBHOOKS ──────────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id)
  `);

  // ── BADGES ────────────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_badges_name ON badges(name)
  `);

  // ── USER BADGES ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (user_id, badge_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id)
  `);

  // ── BILLING HISTORY ───────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id)
  `);

  // ── ADMIN AUDIT LOG ───────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at)
  `);

  // ── ADMIN USER NOTES ──────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_user_notes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user ON admin_user_notes(user_id)
  `);

  // ── DISCORD CONNECTIONS ───────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_discord_id ON discord_connections(discord_id)
  `);

  // ── STAFF ACTIVITY ────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_staff_activity_heartbeat ON staff_activity(last_heartbeat DESC)
  `);

  // ── AUTH TOKENS ───────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_billing_verify_expires ON billing_verification_codes(expires_at)
  `);

  // ── NOTIFICATION PREFERENCES ──────────────────────────────────────────
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
      email_schedules BOOLEAN NOT NULL DEFAULT true,
      email_api_keys BOOLEAN NOT NULL DEFAULT true,
      email_api_limit_warning BOOLEAN NOT NULL DEFAULT true,
      email_webhooks BOOLEAN NOT NULL DEFAULT true,
      email_webhook_failure BOOLEAN NOT NULL DEFAULT true,
      email_data_requests BOOLEAN NOT NULL DEFAULT true,
      email_account_deletion BOOLEAN NOT NULL DEFAULT true,
      email_team_invite BOOLEAN NOT NULL DEFAULT true,
      email_team_changes BOOLEAN NOT NULL DEFAULT true,
      email_product_updates BOOLEAN NOT NULL DEFAULT true,
      email_tips_guides BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences(user_id)
  `);

  // ── RATE LIMITING ─────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) NOT NULL,
      "count" INTEGER NOT NULL DEFAULT 1,
      window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE(key, window_start)
    );
    CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key)
  `);

  // ── DEVICE TRUST ──────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_device_trust_user_id ON device_trust(user_id)
  `);

  // ── DATA REQUESTS ─────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_data_requests_user_id ON data_requests(user_id)
  `);

  // ── TEAMS ─────────────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token)
  `);

  // ── GIFTED SUBSCRIPTIONS ──────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_expires ON gifted_subscriptions(expires_at) WHERE revoked_at IS NULL
  `);

  // ── ADMIN NOTIFICATIONS ───────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_admin_notifications_cookie ON admin_notifications (cookie_id)
  `);

  // ── ACCESS RULES ──────────────────────────────────────────────────────
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
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      UNIQUE(rule_type, value_type, value)
    );
    CREATE INDEX IF NOT EXISTS idx_access_rules_active ON access_rules(is_active, rule_type);
    CREATE INDEX IF NOT EXISTS idx_access_rules_value ON access_rules(value);
    CREATE INDEX IF NOT EXISTS idx_access_rules_type ON access_rules(value_type)
  `);

  // ── SECURITY ALERTS ───────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON security_alerts(created_at DESC)
  `);

  // ── SYSTEM SETTINGS ───────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) NOT NULL UNIQUE,
      value TEXT NOT NULL,
      description TEXT,
      setting_type VARCHAR(50) DEFAULT 'string',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // ── BROADCAST ─────────────────────────────────────────────────────────
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
    CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_user ON broadcast_recipients(user_id)
  `);

  // ── SUBDOMAIN CACHE ───────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subdomain_cache (
      domain VARCHAR(255) PRIMARY KEY,
      subdomains JSONB NOT NULL,
      cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_subdomain_cache_cached_at ON subdomain_cache(cached_at)
  `);
}
