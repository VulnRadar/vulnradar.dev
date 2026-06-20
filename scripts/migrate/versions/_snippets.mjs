/**
 * VulnRadar — Shared DDL snippets for version transitions.
 *
 * Inline SQL definitions that more than one transition file needs. Keep
 * this file tiny and version-agnostic — anything that has a version label
 * belongs in the transition file itself.
 *
 * The DDL in this file MUST be a strict mirror of the v2 table
 * definitions in `instrumentation.ts` (line 405+). If you change a
 * column there, change it here too — `audit-v2-tables.py` (in
 * `$TEMP/opencode`) cross-checks the two and reports drift.
 */

/**
 * v2 tables — the 15 tables the v1→v2 upgrade adds on top of the v1
 * baseline. The DDL here is identical to `instrumentation.ts` line 405+.
 */
export const V2_NEW_TABLES = {
  access_rules: `
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
    )
  `,
  admin_notifications: `
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
    )
  `,
  admin_user_notes: `
    CREATE TABLE IF NOT EXISTS admin_user_notes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `,
  badges: `
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
    )
  `,
  user_badges: `
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (user_id, badge_id)
    )
  `,
  billing_history: `
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
    )
  `,
  billing_verification_codes: `
    CREATE TABLE IF NOT EXISTS billing_verification_codes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `,
  broadcast_messages: `
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
    )
  `,
  broadcast_recipients: `
    CREATE TABLE IF NOT EXISTS broadcast_recipients (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      opened_at TIMESTAMP WITH TIME ZONE,
      clicked_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'opened', 'clicked')),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `,
  discord_connections: `
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
    )
  `,
  gifted_subscriptions: `
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
    )
  `,
  security_alerts: `
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
    )
  `,
  staff_activity: `
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
    )
  `,
  subdomain_cache: `
    CREATE TABLE IF NOT EXISTS subdomain_cache (
      domain VARCHAR(255) PRIMARY KEY,
      subdomains JSONB NOT NULL,
      cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `,
  system_settings: `
    CREATE TABLE IF NOT EXISTS system_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(100) NOT NULL UNIQUE,
      value TEXT NOT NULL,
      description TEXT,
      setting_type VARCHAR(50) DEFAULT 'string',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `,
};
