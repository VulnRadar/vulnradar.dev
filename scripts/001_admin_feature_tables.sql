-- IP Rules Table for Whitelisting/Blacklisting
CREATE TABLE IF NOT EXISTS ip_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address INET NOT NULL,
  rule_type VARCHAR(10) NOT NULL CHECK (rule_type IN ('whitelist', 'blacklist')),
  reason TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  hit_count INTEGER DEFAULT 0,
  last_hit TIMESTAMP WITH TIME ZONE,
  UNIQUE(ip_address, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_ip_rules_active ON ip_rules(is_active, rule_type);
CREATE INDEX IF NOT EXISTS idx_ip_rules_ip ON ip_rules(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_rules_expires ON ip_rules(expires_at) WHERE expires_at IS NOT NULL;

-- Security Alerts Table
CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('failed_login', 'suspicious_activity', 'unusual_location', 'multiple_ips', 'api_abuse', 'brute_force')),
  description TEXT NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ip_address INET,
  user_agent TEXT,
  location_data JSONB,
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  action_taken TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_security_alerts_user ON security_alerts(user_id, is_resolved);
CREATE INDEX IF NOT EXISTS idx_security_alerts_severity ON security_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON security_alerts(created_at DESC);

-- System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSONB NOT NULL,
  description TEXT,
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at_prev TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);

-- Broadcast Messages Table
CREATE TABLE IF NOT EXISTS broadcast_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('email', 'in_app', 'both')),
  target_segment VARCHAR(50) NOT NULL CHECK (target_segment IN ('all', 'free', 'trial', 'paid', 'staff', 'custom')),
  custom_filter JSONB,
  status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'scheduled', 'sent', 'failed', 'cancelled')) DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  scheduled_for TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  recipient_count INTEGER,
  opened_count INTEGER DEFAULT 0,
  clicked_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_broadcast_status ON broadcast_messages(status);
CREATE INDEX IF NOT EXISTS idx_broadcast_created ON broadcast_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_scheduled ON broadcast_messages(scheduled_for) WHERE scheduled_for IS NOT NULL;

-- Broadcast Recipients Log (for tracking)
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  sent_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  failed_reason TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_user ON broadcast_recipients(user_id);

-- Password Rotation Policy Table
CREATE TABLE IF NOT EXISTS password_rotation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name VARCHAR(100) NOT NULL UNIQUE,
  days_until_expiry INTEGER NOT NULL DEFAULT 90,
  days_warning INTEGER NOT NULL DEFAULT 14,
  is_active BOOLEAN DEFAULT true,
  apply_to_all_users BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- User Password Change Requirements
CREATE TABLE IF NOT EXISTS user_password_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
  last_password_change TIMESTAMP WITH TIME ZONE DEFAULT now(),
  next_password_change_due TIMESTAMP WITH TIME ZONE,
  force_change_on_next_login BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_password_requirements_due ON user_password_requirements(next_password_change_due) WHERE force_change_on_next_login = true;
