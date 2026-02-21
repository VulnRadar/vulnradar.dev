-- Rename notification_preferences columns to match the new schema
-- Uses IF EXISTS pattern via DO block to be safe if columns already have new names

DO $$ BEGIN
  -- Security columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_login_alerts') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_login_alerts TO email_new_login;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_password_changes') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_password_changes TO email_password_change;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_two_factor_changes') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_two_factor_changes TO email_2fa_change;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_session_alerts') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_session_alerts TO email_session_revoked;
  END IF;

  -- Scanning columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_scan_failures') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_scan_failures TO email_critical_findings;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_severity_alerts') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_severity_alerts TO email_regression_alert;
  END IF;

  -- API columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_api_usage_alerts') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_api_usage_alerts TO email_api_limit_warning;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_webhook_failures') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_webhook_failures TO email_webhook_failure;
  END IF;

  -- Account columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_account_changes') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_account_changes TO email_account_deletion;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_team_invites') THEN
    ALTER TABLE notification_preferences RENAME COLUMN email_team_invites TO email_team_invite;
  END IF;

  -- Add missing columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_preferences' AND column_name = 'email_team_changes') THEN
    ALTER TABLE notification_preferences ADD COLUMN email_team_changes BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;
