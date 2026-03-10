-- VulnRadar Fresh Database Setup Script
-- This creates all tables from scratch for a new installation.
-- Run with: node scripts/migrate.mjs --fresh
-- Or manually via your database client.

-- ════════════════════════════════════════════════════════════════
-- USERS - The central table. Contains ALL user data.
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  
  -- Core identity
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  
  -- Role & permissions
  -- Values: 'user', 'beta_tester', 'support', 'moderator', 'admin'
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  
  -- Subscription & billing
  plan VARCHAR(50) NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255) UNIQUE,
  stripe_subscription_id VARCHAR(255) UNIQUE,
  subscription_status VARCHAR(50) DEFAULT 'active',
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  
  -- Feature flags
  beta_access BOOLEAN NOT NULL DEFAULT false,
  
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
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- ════════════════════════════════════════════════════════════════
-- SESSIONS - User login sessions
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- API KEYS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT 'Default',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

-- ════════════════════════════════════════════════════════════════
-- API USAGE - Tracks API key usage for rate limiting
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(api_key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_used_at ON api_usage(used_at);

-- ════════════════════════════════════════════════════════════════
-- SCAN HISTORY
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- SCAN TAGS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scan_tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
  tag VARCHAR(50) NOT NULL,
  UNIQUE(scan_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_scan_tags_scan_id ON scan_tags(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_tags_user_id ON scan_tags(user_id);

-- ════════════════════════════════════════════════════════════════
-- SCHEDULED SCANS
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- WEBHOOKS
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- BADGES - Badge definitions
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- USER BADGES - Junction table
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

-- ════════════════════════════════════════════════════════════════
-- BILLING HISTORY
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- ADMIN AUDIT LOG
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- AUTH TOKENS
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- NOTIFICATION PREFERENCES
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notification_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email_security BOOLEAN NOT NULL DEFAULT true,
  email_new_login BOOLEAN NOT NULL DEFAULT true,
  email_password_change BOOLEAN NOT NULL DEFAULT true,
  email_2fa_change BOOLEAN NOT NULL DEFAULT true,
  email_scan_complete BOOLEAN NOT NULL DEFAULT true,
  email_critical_findings BOOLEAN NOT NULL DEFAULT true,
  email_api_keys BOOLEAN NOT NULL DEFAULT true,
  email_webhooks BOOLEAN NOT NULL DEFAULT true,
  email_product_updates BOOLEAN NOT NULL DEFAULT true,
  email_tips_guides BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id ON notification_preferences(user_id);

-- ════════════════════════════════════════════════════════════════
-- RATE LIMITING
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);

-- ════════════════════════════════════════════════════════════════
-- DEVICE TRUST - Trusted devices for 2FA
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- DATA REQUESTS - GDPR data export
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- TEAMS
-- ════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════
-- SEED DEFAULT BADGES
-- ════════════════════════════════════════════════════════════════
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
