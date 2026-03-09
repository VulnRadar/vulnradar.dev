-- ============================================================================
-- VulnRadar Database Migration: Consolidate to Clean Schema
-- ============================================================================
-- This script migrates from the old scattered schema to the new clean schema
-- where all user data lives in the users table.
--
-- RUN THIS ONCE to migrate existing data, then restart your app.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 1: Add new columns to users table (if they don't exist)
-- ════════════════════════════════════════════════════════════════════════════

-- Subscription fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Beta access flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS beta_access BOOLEAN NOT NULL DEFAULT false;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 2: Migrate data from subscriptions table to users
-- ════════════════════════════════════════════════════════════════════════════

UPDATE users u
SET 
  plan = COALESCE(s.plan, 'free'),
  stripe_customer_id = s.stripe_customer_id,
  stripe_subscription_id = s.stripe_subscription_id,
  subscription_status = COALESCE(s.status, 'active'),
  current_period_end = s.current_period_end,
  cancel_at_period_end = COALESCE(s.cancel_at_period_end, false)
FROM subscriptions s
WHERE u.id = s.user_id
  AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions');

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 3: Migrate beta access from user_beta_access to users.beta_access
-- ════════════════════════════════════════════════════════════════════════════

UPDATE users u
SET beta_access = true
WHERE EXISTS (
  SELECT 1 FROM user_beta_access uba WHERE uba.user_id = u.id
)
AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_beta_access');

-- Also set beta_access for users with beta_tester role
UPDATE users SET beta_access = true WHERE role = 'beta_tester';

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 4: Drop old tables that are no longer needed
-- ════════════════════════════════════════════════════════════════════════════

-- Drop junction tables first (foreign key constraints)
DROP TABLE IF EXISTS user_permission_tags CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS user_beta_access CASCADE;

-- Drop definition tables
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS beta_features CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS daily_request_limits CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- STEP 5: Clean up any orphaned data
-- ════════════════════════════════════════════════════════════════════════════

-- Remove expired sessions
DELETE FROM sessions WHERE expires_at < NOW();

-- Remove expired password reset tokens
DELETE FROM password_reset_tokens WHERE expires_at < NOW();

-- Remove expired email verification tokens
DELETE FROM email_verification_tokens WHERE expires_at < NOW();

-- Remove expired 2FA codes
DELETE FROM email_2fa_codes WHERE expires_at < NOW();

-- Remove expired device trust entries
DELETE FROM device_trust WHERE expires_at < NOW();

-- ════════════════════════════════════════════════════════════════════════════
-- DONE! Your database is now using the clean schema.
-- ════════════════════════════════════════════════════════════════════════════
