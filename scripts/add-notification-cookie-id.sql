-- Add cookie_id column to admin_notifications for unique per-notification dismiss tracking
-- Each notification gets its own cookie name so multiple banners can be shown/dismissed independently

-- Add the column if it doesn't exist
ALTER TABLE admin_notifications 
ADD COLUMN IF NOT EXISTS cookie_id VARCHAR(32);

-- Generate unique cookie_ids for any existing notifications that don't have one
UPDATE admin_notifications 
SET cookie_id = 'notif_' || SUBSTRING(MD5(RANDOM()::TEXT || id::TEXT || NOW()::TEXT) FROM 1 FOR 16)
WHERE cookie_id IS NULL;

-- Make the column NOT NULL and UNIQUE after populating
ALTER TABLE admin_notifications 
ALTER COLUMN cookie_id SET NOT NULL;

-- Add unique constraint if not exists (this will fail silently if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_notifications_cookie_id_key'
  ) THEN
    ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_cookie_id_key UNIQUE (cookie_id);
  END IF;
END $$;

-- Add index for cookie lookups
CREATE INDEX IF NOT EXISTS idx_admin_notifications_cookie ON admin_notifications (cookie_id);
