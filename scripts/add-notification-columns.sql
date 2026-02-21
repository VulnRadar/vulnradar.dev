-- Add missing notification preference columns to notification_preferences table
ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS email_login_alerts BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_password_changes BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_session_alerts BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_scan_complete BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_scan_failures BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_severity_alerts BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_api_usage_alerts BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_webhook_failures BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_data_requests BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_account_changes BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_team_invites BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_product_updates BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_tips_guides BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_two_factor_changes BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_schedule_notifications BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_api_key_notifications BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS email_webhook_notifications BOOLEAN NOT NULL DEFAULT true;
