-- Add cookie_id column to admin_notifications table
-- This column uniquely identifies each notification for cookie-based dismiss tracking

-- Add the column as nullable first
ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS cookie_id VARCHAR(32);

-- Generate cookie_id for any existing rows that don't have one
UPDATE admin_notifications 
SET cookie_id = 'notif_' || SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT) FROM 1 FOR 16)
WHERE cookie_id IS NULL;

-- Now make it NOT NULL and add constraints
ALTER TABLE admin_notifications ALTER COLUMN cookie_id SET NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_notifications_cookie_id_key'
  ) THEN
    ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_cookie_id_key UNIQUE (cookie_id);
  END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_notifications_cookie ON admin_notifications (cookie_id);
