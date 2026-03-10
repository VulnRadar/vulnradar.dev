-- Create gifted_subscriptions table
-- Tracks manually gifted plan access with an expiry date
CREATE TABLE IF NOT EXISTS gifted_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gifted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan VARCHAR(50) NOT NULL,
  reason TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_user ON gifted_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_expires ON gifted_subscriptions(expires_at) WHERE revoked_at IS NULL;
