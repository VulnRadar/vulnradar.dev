-- Migration: Add subscription plans and permissions support
-- This migration adds subscription tier support and permissions management

-- Add subscription columns to users table if they don't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20) NOT NULL DEFAULT 'FREE',
ADD COLUMN IF NOT EXISTS subscription_tier INTEGER NOT NULL DEFAULT 0;

-- Create index for subscription queries
CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan);

-- Create user_permissions table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, permission_name)
);

-- Create index for permission queries
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);

-- Set default subscription plan for existing users (already set in ADD COLUMN default)
UPDATE users SET subscription_plan = 'FREE' WHERE subscription_plan IS NULL;
UPDATE users SET subscription_tier = 0 WHERE subscription_tier IS NULL;
