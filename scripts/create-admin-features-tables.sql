-- Create broadcast_messages table for mass email feature
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'email',
  segment_filter JSONB DEFAULT '{"segment": "all"}',
  status VARCHAR(50) DEFAULT 'draft',
  recipient_count INTEGER DEFAULT 0,
  opened_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP
);

-- Create system_settings table for admin settings
CREATE TABLE IF NOT EXISTS system_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  description TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create ip_rules table for IP/URL whitelist/blacklist
CREATE TABLE IF NOT EXISTS ip_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(20) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
  value_type VARCHAR(10) DEFAULT 'ip' CHECK (value_type IN ('ip', 'url')),
  ip_address VARCHAR(255) NOT NULL,
  description TEXT,
  reason TEXT,
  is_active BOOLEAN DEFAULT true,
  hit_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Create security_alerts table
CREATE TABLE IF NOT EXISTS security_alerts (
  id SERIAL PRIMARY KEY,
  alert_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details JSONB,
  user_id INTEGER REFERENCES users(id),
  resolved_at TIMESTAMP,
  resolved_by INTEGER REFERENCES users(id),
  action_taken TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default system settings
INSERT INTO system_settings (key, value, description) VALUES
  ('maintenance_mode', 'false', 'Enable/disable maintenance mode'),
  ('maintenance_message', 'We are currently performing scheduled maintenance. Please check back soon.', 'Message shown during maintenance')
ON CONFLICT (key) DO NOTHING;
