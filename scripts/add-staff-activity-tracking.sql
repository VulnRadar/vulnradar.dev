-- Create staff activity tracking table
-- Tracks real-time presence of staff members in the admin dashboard
-- Activity is updated every 60 seconds via client-side heartbeat

CREATE TABLE IF NOT EXISTS staff_activity (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  current_section VARCHAR(50),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Index for quick lookups of staff activity by user and timestamp
CREATE INDEX IF NOT EXISTS idx_staff_activity_user_heartbeat ON staff_activity(user_id, last_heartbeat DESC);

-- Index for getting all recent activity
CREATE INDEX IF NOT EXISTS idx_staff_activity_heartbeat ON staff_activity(last_heartbeat DESC);

-- Function to clean up old activity records (older than 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_staff_activity() RETURNS void AS $$
BEGIN
  DELETE FROM staff_activity
  WHERE last_heartbeat < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
