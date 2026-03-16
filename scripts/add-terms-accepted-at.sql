-- Add terms_accepted_at column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Set existing users to have accepted terms at their account creation date
-- This prevents blocking existing users who already accepted the old terms
UPDATE users SET terms_accepted_at = created_at WHERE terms_accepted_at IS NULL;
