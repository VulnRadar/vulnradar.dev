-- Migration: Expand notification_preferences + Add Email 2FA support
-- Run this ONCE against your database.

-- ══════════════════════════════════════════════════
-- 1. Add new notification preference columns
-- ══════════════════════════════════════════════════

-- Security section (new)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_new_login') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_new_login BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_password_change') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_password_change BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_2fa_change') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_2fa_change BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_session_revoked') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_session_revoked BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Scanning section (new)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_scan_complete') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_scan_complete BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_critical_findings') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_critical_findings BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_regression_alert') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_regression_alert BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- API & Integrations section (new columns alongside existing api_keys/webhooks)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_api_limit_warning') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_api_limit_warning BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_webhook_failure') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_webhook_failure BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Account section (new)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_team_invite') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_team_invite BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_team_changes') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_team_changes BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_account_deletion') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_account_deletion BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Product section (new)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_product_updates') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_product_updates BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notification_preferences' AND column_name='email_tips_guides') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_tips_guides BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;


-- ══════════════════════════════════════════════════
-- 2. Backfill: existing users get defaults enabled
--    (DEFAULT on ADD COLUMN already handles this, but
--     let's be explicit for rows that were inserted
--     with partial columns before.)
-- ══════════════════════════════════════════════════

UPDATE notification_preferences SET
  email_new_login       = COALESCE(email_new_login, true),
  email_password_change = COALESCE(email_password_change, true),
  email_2fa_change      = COALESCE(email_2fa_change, true),
  email_session_revoked = COALESCE(email_session_revoked, true),
  email_scan_complete   = COALESCE(email_scan_complete, true),
  email_critical_findings = COALESCE(email_critical_findings, true),
  email_regression_alert  = COALESCE(email_regression_alert, true),
  email_api_limit_warning = COALESCE(email_api_limit_warning, true),
  email_webhook_failure   = COALESCE(email_webhook_failure, true),
  email_team_invite       = COALESCE(email_team_invite, true),
  email_team_changes      = COALESCE(email_team_changes, true),
  email_account_deletion  = COALESCE(email_account_deletion, true),
  email_product_updates   = COALESCE(email_product_updates, true),
  email_tips_guides       = COALESCE(email_tips_guides, false);


-- ══════════════════════════════════════════════════
-- 3. Add two_factor_method to users
-- ══════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='two_factor_method') THEN
    ALTER TABLE users ADD COLUMN two_factor_method VARCHAR(20) NOT NULL DEFAULT 'app';
  END IF;
END $$;

-- Backfill: existing users with totp_enabled=true use 'app'
UPDATE users SET two_factor_method = 'app' WHERE totp_enabled = true AND two_factor_method = 'app';


-- ══════════════════════════════════════════════════
-- 4. Email 2FA codes table
-- ══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_2fa_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_2fa_user_id ON email_2fa_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_email_2fa_expires ON email_2fa_codes(expires_at);
