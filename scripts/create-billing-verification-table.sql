-- Create billing_verification_codes table for secure billing info access
CREATE TABLE IF NOT EXISTS billing_verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_billing_verification_codes_user_id ON billing_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_verification_codes_expires_at ON billing_verification_codes(expires_at);

-- Clean up expired codes periodically (optional - can also be done via cron)
-- DELETE FROM billing_verification_codes WHERE expires_at < NOW();
