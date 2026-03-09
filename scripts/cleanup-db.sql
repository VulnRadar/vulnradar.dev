-- ============================================================================
-- VulnRadar Database Cleanup & Consolidation
-- ============================================================================
-- This script consolidates the database by:
-- 1. Adding subscription/billing fields directly to users table
-- 2. Migrating data from subscriptions table to users
-- 3. Dropping unnecessary role/permission tables (use role column in users)
-- 4. Keeping: badges, user_badges, billing_history
-- ============================================================================

-- Step 1: Add new columns to users table for subscription data
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;

-- Step 2: Migrate existing subscription data to users table
UPDATE users u
SET 
  plan = COALESCE(s.plan, 'free'),
  stripe_customer_id = s.stripe_customer_id,
  stripe_subscription_id = s.stripe_subscription_id,
  subscription_status = COALESCE(s.status, 'active'),
  subscription_period_end = s.current_period_end,
  cancel_at_period_end = COALESCE(s.cancel_at_period_end, false)
FROM subscriptions s
WHERE s.user_id = u.id;

-- Step 3: Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_users_plan ON users(plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- Step 4: Drop the tables we no longer need
-- First drop tables with foreign key dependencies
DROP TABLE IF EXISTS user_beta_access CASCADE;
DROP TABLE IF EXISTS beta_features CASCADE;
DROP TABLE IF EXISTS user_permission_tags CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS daily_request_limits CASCADE;

-- Done! The database is now cleaner with:
-- - users table has plan, stripe_customer_id, stripe_subscription_id, subscription_status, etc.
-- - role column in users handles user roles (user, moderator, admin, etc.)
-- - badges and user_badges tables remain for cosmetic badges
-- - billing_history remains for invoice records
